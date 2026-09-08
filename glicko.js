// TrueSkill defaults for head-to-head and team matches.
const INITIAL_MU = 25;
const INITIAL_SIGMA = INITIAL_MU / 3;
const BETA = INITIAL_MU / 6;
const DYNAMICS_FACTOR = INITIAL_MU / 300;
const SEASON_START_MONTH = 9;
const HARVARD_TIME_ZONE = 'America/New_York';
const RECENT_MATCH_LIMIT = 10;

const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('admin') === 'true';

const appState = {
    players: {},
    matches: {},
    selectedSeason: null,
    matchType: '1v1'
};

const matchHistoryState = {
    limit: RECENT_MATCH_LIMIT
};

function normalPdf(value) {
    return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function normalCdf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * x);
    const coefficients = [
        0.254829592,
        -0.284496736,
        1.421413741,
        -1.453152027,
        1.061405429
    ];
    const polynomial = coefficients.reduceRight((result, coefficient) =>
        (result + coefficient) * t
    , 0);
    const erf = sign * (1 - polynomial * Math.exp(-x * x));
    return 0.5 * (1 + erf);
}

function inverseMillsRatio(value) {
    if (value < -5.5) {
        const positive = -value;
        return positive + 1 / positive - 2 / (positive ** 3) + 10 / (positive ** 5);
    }
    return normalPdf(value) / Math.max(normalCdf(value), 1e-12);
}

function createTrueSkillPlayer() {
    return {
        mu: INITIAL_MU,
        sigma: INITIAL_SIGMA,
        matches: 0,
        wins: 0
    };
}

function rateTeams(winners, losers) {
    const allPlayers = [...winners, ...losers];
    const winnerMean = winners.reduce((sum, player) => sum + player.mu, 0);
    const loserMean = losers.reduce((sum, player) => sum + player.mu, 0);
    const variance = allPlayers.reduce((sum, player) =>
        sum + player.sigma * player.sigma + DYNAMICS_FACTOR * DYNAMICS_FACTOR + BETA * BETA
    , 0);
    const performanceScale = Math.sqrt(variance);
    const normalizedDifference = (winnerMean - loserMean) / performanceScale;
    const v = inverseMillsRatio(normalizedDifference);
    const w = Math.min(v * (v + normalizedDifference), 0.9999);

    const updatePlayer = (player, direction) => {
        const adjustedVariance = player.sigma * player.sigma + DYNAMICS_FACTOR * DYNAMICS_FACTOR;
        const meanMultiplier = adjustedVariance / performanceScale;
        const varianceMultiplier = adjustedVariance / variance;
        return {
            ...player,
            mu: player.mu + direction * meanMultiplier * v,
            sigma: Math.sqrt(Math.max(adjustedVariance * (1 - varianceMultiplier * w), 0.0001))
        };
    };

    return {
        winners: winners.map(player => updatePlayer(player, 1)),
        losers: losers.map(player => updatePlayer(player, -1))
    };
}

function getMatchTeams(match) {
    const winnerTeam = Array.isArray(match.winnerTeam)
        ? match.winnerTeam
        : (match.winner ? [match.winner] : []);
    const loserTeam = Array.isArray(match.loserTeam)
        ? match.loserTeam
        : (match.loser ? [match.loser] : []);
    return { winnerTeam, loserTeam };
}

function formatTrueSkill(value) {
    return Number(value).toFixed(2);
}

function getHarvardDateParts(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: HARVARD_TIME_ZONE,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    }).formatToParts(date);

    return Object.fromEntries(
        parts
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, Number(part.value)])
    );
}

function getSeasonStartYear(dateValue = new Date()) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    const { year, month } = getHarvardDateParts(date);
    return month >= SEASON_START_MONTH ? year : year - 1;
}

function getCurrentSeason() {
    return getSeasonStartYear(new Date());
}

function getSeasonLabel(startYear) {
    const shortStart = String(startYear).slice(-2);
    const shortEnd = String(startYear + 1).slice(-2);
    return `${shortStart}/${shortEnd}`;
}

function getSeasonDateLabel(startYear) {
    return `Sep 1, ${startYear} – Aug 31, ${startYear + 1}`;
}

function getAvailableSeasons() {
    const seasons = new Set([getCurrentSeason()]);
    Object.values(appState.matches).forEach(match => {
        if (match.timestamp) seasons.add(getSeasonStartYear(match.timestamp));
    });
    return [...seasons].sort((a, b) => b - a);
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML;
}

function calculateSeason(startYear, matches = appState.matches) {
    const seasonMatches = Object.entries(matches)
        .filter(([, match]) => match.timestamp && getSeasonStartYear(match.timestamp) === startYear)
        .map(([id, match]) => ({ ...match, id }))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const names = new Set();
    seasonMatches.forEach(match => {
        const { winnerTeam, loserTeam } = getMatchTeams(match);
        [...winnerTeam, ...loserTeam].forEach(name => names.add(name));
    });

    const players = {};
    names.forEach(name => {
        players[name] = createTrueSkillPlayer();
    });

    const calculatedMatches = [];
    seasonMatches.forEach(match => {
        const { winnerTeam, loserTeam } = getMatchTeams(match);
        if (winnerTeam.length === 0 || loserTeam.length === 0) return;
        if ([...winnerTeam, ...loserTeam].some(name => !players[name])) return;

        const winnerPlayers = winnerTeam.map(name => players[name]);
        const loserPlayers = loserTeam.map(name => players[name]);
        const beforeMu = Object.fromEntries(
            [...winnerTeam, ...loserTeam].map(name => [name, players[name].mu])
        );
        const rated = rateTeams(winnerPlayers, loserPlayers);

        winnerTeam.forEach((name, index) => {
            players[name] = {
                ...rated.winners[index],
                matches: players[name].matches + 1,
                wins: players[name].wins + 1
            };
        });
        loserTeam.forEach((name, index) => {
            players[name] = {
                ...rated.losers[index],
                matches: players[name].matches + 1,
                wins: players[name].wins
            };
        });

        const ratingChanges = Object.fromEntries(
            [...winnerTeam, ...loserTeam].map(name => [name, players[name].mu - beforeMu[name]])
        );
        calculatedMatches.push({
            ...match,
            winnerTeam,
            loserTeam,
            ratingChanges
        });
    });

    return { players, matches: calculatedMatches };
}

function renderSeasonTabs() {
    const tabs = document.getElementById('seasonTabs');
    tabs.innerHTML = '';

    getAvailableSeasons().forEach(startYear => {
        const button = document.createElement('button');
        const isActive = startYear === appState.selectedSeason;
        button.type = 'button';
        button.className = `season-tab${isActive ? ' active' : ''}`;
        button.textContent = getSeasonLabel(startYear);
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(isActive));
        button.addEventListener('click', () => {
            appState.selectedSeason = startYear;
            render();
        });
        tabs.appendChild(button);
    });
}

function renderSeasonPodium(players, isCurrentSeason) {
    const podium = document.getElementById('seasonPodium');
    const finalists = Object.entries(players)
        .sort((a, b) => b[1].mu - a[1].mu || b[1].wins - a[1].wins || a[0].localeCompare(b[0]))
        .slice(0, 3);

    if (isCurrentSeason || finalists.length === 0) {
        podium.hidden = true;
        podium.innerHTML = '';
        return;
    }

    const places = [
        { finalist: finalists[1], place: 2, medal: '🥈', className: 'second' },
        { finalist: finalists[0], place: 1, medal: '🥇', className: 'first' },
        { finalist: finalists[2], place: 3, medal: '🥉', className: 'third' }
    ].filter(entry => entry.finalist);

    podium.innerHTML = `
        <div class="podium-places">
            ${places.map(({ finalist: [name, player], place, medal, className }) => `
                <div class="podium-place ${className}">
                    <span class="podium-medal" aria-hidden="true">${medal}</span>
                    <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
                    <span class="podium-skill">${formatTrueSkill(player.mu)} skill</span>
                    <div class="podium-step" aria-label="${place}${place === 1 ? 'st' : place === 2 ? 'nd' : 'rd'} place">${place}</div>
                </div>
            `).join('')}
        </div>
    `;
    podium.hidden = false;
}

function updateRankings(players) {
    const rankingsDiv = document.getElementById('rankings');
    const entries = Object.entries(players);

    if (entries.length === 0) {
        rankingsDiv.innerHTML = '<p>No games yet :(</p>';
        return;
    }

    const sortedPlayers = entries.sort((a, b) =>
        b[1].mu - a[1].mu || b[1].wins - a[1].wins || a[0].localeCompare(b[0])
    );

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Player</th>
                    <th>Skill (μ) <button type="button" class="info-icon" onclick="showInfo('skill')" aria-label="About TrueSkill skill">ⓘ</button></th>
                    <th>Uncertainty (σ) <button type="button" class="info-icon" onclick="showInfo('uncertainty')" aria-label="About TrueSkill uncertainty">ⓘ</button></th>
                    <th>Record</th>
                    <th>Win Rate</th>
                    ${isAdmin && appState.selectedSeason === getCurrentSeason() ? '<th>Action</th>' : ''}
                </tr>
            </thead>
            <tbody>
    `;
    let mobileHtml = '<div class="mobile-rankings">';

    sortedPlayers.forEach(([name, player], index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const losses = player.matches - player.wins;
        const winRate = player.matches > 0 ? ((player.wins / player.matches) * 100).toFixed(1) : '0.0';
        const canDelete = isAdmin && appState.selectedSeason === getCurrentSeason() && appState.players[name];

        html += `
            <tr>
                <td class="${rankClass}">${rank}</td>
                <td>${escapeHtml(name)}</td>
                <td>${formatTrueSkill(player.mu)}</td>
                <td>${formatTrueSkill(player.sigma)}</td>
                <td>${player.wins}-${losses}</td>
                <td>${winRate}%</td>
                ${canDelete ? `<td><button class="delete-btn" data-delete-player="${escapeHtml(name)}">Delete</button></td>` : (isAdmin && appState.selectedSeason === getCurrentSeason() ? '<td></td>' : '')}
            </tr>
        `;
        mobileHtml += `
            <div class="mobile-ranking-row">
                <span class="mobile-rank ${rankClass}">${rank}</span>
                <span class="mobile-player" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                <span class="mobile-stat"><small>Skill μ</small>${formatTrueSkill(player.mu)}</span>
                <span class="mobile-stat"><small>Record</small>${player.wins}-${losses}</span>
                ${canDelete ? `<button class="delete-btn mobile-delete" data-delete-player="${escapeHtml(name)}">Delete</button>` : ''}
            </div>
        `;
    });

    html += '</tbody></table>';
    mobileHtml += '</div>';
    rankingsDiv.innerHTML = html + mobileHtml;
}

function updatePlayerOptions(players) {
    document.querySelectorAll('.player-search').forEach(input => {
        const selectedPlayer = input.dataset.selectedPlayer;
        if (selectedPlayer && !players[selectedPlayer]) {
            input.value = '';
            delete input.dataset.selectedPlayer;
        }
        if (input.getAttribute('aria-expanded') === 'true') renderPlayerOptions(input);
    });
}

function closePlayerPicker(input) {
    const options = input.parentElement.querySelector('.player-options');
    options.hidden = true;
    input.setAttribute('aria-expanded', 'false');
}

function renderPlayerOptions(input) {
    const options = input.parentElement.querySelector('.player-options');
    const query = input.value.trim().toLocaleLowerCase();
    const selectedElsewhere = new Set(
        [...document.querySelectorAll('.player-search')]
            .filter(otherInput => otherInput !== input)
            .map(otherInput => otherInput.dataset.selectedPlayer)
            .filter(Boolean)
    );
    const matches = Object.keys(appState.players)
        .filter(name => !selectedElsewhere.has(name))
        .filter(name => name.toLocaleLowerCase().includes(query))
        .sort((a, b) => {
            const aStarts = a.toLocaleLowerCase().startsWith(query);
            const bStarts = b.toLocaleLowerCase().startsWith(query);
            return Number(bStarts) - Number(aStarts) || a.localeCompare(b);
        });

    options.innerHTML = '';
    if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'player-option-empty';
        empty.textContent = 'No matching players';
        options.appendChild(empty);
    } else {
        matches.forEach(name => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'player-option';
            option.setAttribute('role', 'option');
            option.textContent = name;
            option.addEventListener('click', () => {
                input.value = name;
                input.dataset.selectedPlayer = name;
                closePlayerPicker(input);
                input.focus();
            });
            options.appendChild(option);
        });
    }

    options.hidden = false;
    input.setAttribute('aria-expanded', 'true');
}

function getSelectedPlayer(inputId) {
    const input = document.getElementById(inputId);
    const selectedPlayer = input.dataset.selectedPlayer;
    return selectedPlayer && input.value === selectedPlayer && appState.players[selectedPlayer]
        ? selectedPlayer
        : null;
}

function clearPlayerPicker(input) {
    input.value = '';
    delete input.dataset.selectedPlayer;
    closePlayerPicker(input);
}

document.querySelectorAll('.player-search').forEach(input => {
    input.addEventListener('focus', () => renderPlayerOptions(input));
    input.addEventListener('input', () => {
        delete input.dataset.selectedPlayer;
        renderPlayerOptions(input);
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closePlayerPicker(input);
            input.blur();
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            input.parentElement.querySelector('.player-option')?.focus();
        }
    });
});

document.addEventListener('click', event => {
    document.querySelectorAll('.player-picker').forEach(picker => {
        if (!picker.contains(event.target)) closePlayerPicker(picker.querySelector('.player-search'));
    });
});

document.addEventListener('focusin', event => {
    if (event.target.matches('.player-option')) return;
    document.querySelectorAll('.player-picker').forEach(picker => {
        if (!picker.contains(event.target)) closePlayerPicker(picker.querySelector('.player-search'));
    });
});

function formatSkillChange(change) {
    const rounded = Number(change).toFixed(2);
    return change >= 0 ? `+${rounded}` : rounded;
}

function formatMatchTeam(team, ratingChanges, resultClass) {
    return team.map(name => `
        <span class="match-player">
            <strong>${escapeHtml(name)}</strong>
            <span class="skill-change ${resultClass}">(${formatSkillChange(ratingChanges[name] || 0)})</span>
        </span>
    `).join('<span class="team-separator"> &amp; </span>');
}

function updateRecentMatches(matches) {
    const matchesDiv = document.getElementById('recentMatches');
    if (matches.length === 0) {
        matchesDiv.innerHTML = '<p>No games yet :(</p>';
        return;
    }

    // Match numbers are chronological within the selected season. Limit to the
    // latest N first, then show that recent subset newest-first.
    const numberedMatches = [...matches]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map((match, index) => ({ ...match, matchNumber: index + 1 }));
    const recentMatches = matchHistoryState.limit === 'all'
        ? numberedMatches
        : numberedMatches.slice(-matchHistoryState.limit);
    const visibleMatches = [...recentMatches].reverse();
    const rows = visibleMatches.map(match => {
        const date = new Date(match.timestamp).toLocaleDateString('en-US', {
            timeZone: HARVARD_TIME_ZONE,
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        const deleteButton = isAdmin
            ? `<button class="delete-btn" data-delete-match="${match.id}">Delete</button>`
            : '';
        const winnerDisplay = formatMatchTeam(match.winnerTeam, match.ratingChanges, 'positive');
        const loserDisplay = formatMatchTeam(match.loserTeam, match.ratingChanges, 'negative');
        return `
            <tr>
                <td>${match.matchNumber}</td>
                <td><span class="match-team">${winnerDisplay}</span></td>
                <td><span class="match-team">${loserDisplay}</span></td>
                <td class="match-date">${date}</td>
                ${isAdmin ? `<td>${deleteButton}</td>` : ''}
            </tr>
        `;
    }).join('');

    matchesDiv.innerHTML = `
        <table class="recent-matches-table">
            <thead>
                <tr>
                    <th>Game</th>
                    <th>Winner</th>
                    <th>Loser</th>
                    <th>Date</th>
                    ${isAdmin ? '<th>Action</th>' : ''}
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function render() {
    if (appState.selectedSeason === null) {
        appState.selectedSeason = getCurrentSeason();
    }

    const season = calculateSeason(appState.selectedSeason);
    const isCurrentSeason = appState.selectedSeason === getCurrentSeason();

    renderSeasonTabs();
    document.getElementById('activeSeasonDates').textContent = getSeasonDateLabel(appState.selectedSeason);
    document.getElementById('rankingsTitle').textContent = 'Season Rankings';
    document.getElementById('seasonMatchCount').textContent = `${season.matches.length} ${season.matches.length === 1 ? 'match' : 'matches'}`;
    document.getElementById('matchesTitle').textContent = 'Season Matches';
    document.getElementById('submitMatchTitle').textContent = 'Submit Match Result';
    document.getElementById('matchEntrySection').hidden = !isCurrentSeason;
    document.getElementById('playerEntrySection').hidden = !isCurrentSeason;

    if (!isCurrentSeason) {
        document.querySelectorAll('.player-search').forEach(clearPlayerPicker);
    }

    renderSeasonPodium(season.players, isCurrentSeason);
    updateRankings(season.players);
    updateRecentMatches(season.matches);
    updatePlayerOptions(appState.players);
}

function loadData() {
    database.ref().on('value', snapshot => {
        const data = snapshot.val() || {};
        appState.players = data.players || {};
        appState.matches = data.matches || {};
        render();
    }, error => {
        showMessage(`Error loading data: ${error.message}`, 'error');
    });
}

function getCurrentSeasonPlayerUpdates(matches) {
    const currentSeason = calculateSeason(getCurrentSeason(), matches);
    const updates = {};
    Object.keys(appState.players).forEach(name => {
        const player = currentSeason.players[name] || createTrueSkillPlayer();
        updates[`players/${name}`] = {
            mu: player.mu,
            sigma: player.sigma,
            matches: player.matches,
            wins: player.wins
        };
    });
    return updates;
}

async function submitMatch(matchData) {
    try {
        const timestamp = new Date().toISOString();
        const matchRef = database.ref('matches').push();
        const draftMatch = { ...matchData, timestamp };
        const projectedMatches = {
            ...appState.matches,
            [matchRef.key]: draftMatch
        };
        const currentSeason = calculateSeason(getCurrentSeason(), projectedMatches);
        const calculatedMatch = currentSeason.matches.find(match => match.id === matchRef.key);

        if (!calculatedMatch) throw new Error('Could not calculate the new match');

        const updates = getCurrentSeasonPlayerUpdates(projectedMatches);
        updates[`matches/${matchRef.key}`] = {
            ...draftMatch,
            ratingChanges: calculatedMatch.ratingChanges
        };

        await database.ref().update(updates);
        showMessage('Match added to the current season!');
        return true;
    } catch (error) {
        showMessage(`Error submitting match: ${error.message}`, 'error');
        return false;
    }
}

function setMatchType(matchType) {
    appState.matchType = matchType;
    const isDoubles = matchType === '2v2';

    document.querySelectorAll('[data-match-type]').forEach(button => {
        const isActive = button.dataset.matchType === matchType;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
    document.querySelectorAll('.partner-field').forEach(field => {
        field.hidden = !isDoubles;
        const input = field.querySelector('input');
        input.required = isDoubles;
        if (!isDoubles) clearPlayerPicker(input);
    });
    document.querySelector('label[for="winner1"]').textContent = isDoubles ? 'Player 1' : 'Player';
    document.querySelector('label[for="loser1"]').textContent = isDoubles ? 'Player 1' : 'Player';
}

document.querySelectorAll('[data-match-type]').forEach(button => {
    button.addEventListener('click', () => setMatchType(button.dataset.matchType));
});

document.getElementById('matchForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (appState.selectedSeason !== getCurrentSeason()) {
        showMessage('Past seasons are view-only', 'error');
        return;
    }
    const winnerTeam = [getSelectedPlayer('winner1')];
    const loserTeam = [getSelectedPlayer('loser1')];

    if (appState.matchType === '2v2') {
        winnerTeam.push(getSelectedPlayer('winner2'));
        loserTeam.push(getSelectedPlayer('loser2'));
    }

    const allPlayers = [...winnerTeam, ...loserTeam];
    if (allPlayers.some(name => !name)) {
        showMessage('Please choose every player from the list', 'error');
        return;
    }

    if (new Set(allPlayers).size !== allPlayers.length) {
        showMessage('Each player can only appear once in a match', 'error');
        return;
    }

    const submitted = await submitMatch({
        format: appState.matchType,
        winnerTeam,
        loserTeam
    });
    if (submitted) {
        event.target.reset();
        document.querySelectorAll('.player-search').forEach(clearPlayerPicker);
    }
});

document.getElementById('playerForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (appState.selectedSeason !== getCurrentSeason()) {
        showMessage('Past seasons are view-only', 'error');
        return;
    }
    const formData = new FormData(event.target);
    const playerName = formData.get('playerName').trim();

    if (!playerName) {
        showMessage('Please enter a valid player name', 'error');
        return;
    }

    try {
        const snapshot = await database.ref(`players/${playerName}`).once('value');
        if (snapshot.exists()) {
            showMessage('Player already exists', 'error');
            return;
        }

        await database.ref(`players/${playerName}`).set({
            mu: INITIAL_MU,
            sigma: INITIAL_SIGMA,
            matches: 0,
            wins: 0
        });
        showMessage(`Player ${playerName} added successfully!`);
        event.target.reset();
    } catch (error) {
        showMessage(`Error adding player: ${error.message}`, 'error');
    }
});

document.getElementById('rankings').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-player]');
    if (button) window.deletePlayer(button.dataset.deletePlayer);
});

document.getElementById('recentMatches').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-match]');
    if (button) window.deleteMatch(button.dataset.deleteMatch);
});

const recentMatchLimitPicker = document.querySelector('.recent-match-limit-picker');
const recentMatchLimitButton = document.getElementById('recentMatchLimitButton');
const recentMatchLimitOptions = document.getElementById('recentMatchLimitOptions');

function closeRecentMatchLimitPicker() {
    recentMatchLimitOptions.hidden = true;
    recentMatchLimitButton.setAttribute('aria-expanded', 'false');
}

function openRecentMatchLimitPicker() {
    recentMatchLimitOptions.hidden = false;
    recentMatchLimitButton.setAttribute('aria-expanded', 'true');
}

recentMatchLimitButton.addEventListener('click', () => {
    if (recentMatchLimitOptions.hidden) {
        openRecentMatchLimitPicker();
    } else {
        closeRecentMatchLimitPicker();
    }
});

recentMatchLimitButton.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    openRecentMatchLimitPicker();
    recentMatchLimitOptions.querySelector('[aria-selected="true"]')?.focus();
});

recentMatchLimitOptions.addEventListener('click', event => {
    const option = event.target.closest('[data-match-limit]');
    if (!option) return;

    const value = option.dataset.matchLimit;
    matchHistoryState.limit = value === 'all' ? 'all' : Number(value);
    document.getElementById('recentMatchLimitValue').textContent = option.textContent;
    recentMatchLimitOptions.querySelectorAll('[data-match-limit]').forEach(candidate => {
        candidate.setAttribute('aria-selected', String(candidate === option));
    });
    closeRecentMatchLimitPicker();
    recentMatchLimitButton.focus();
    updateRecentMatches(calculateSeason(appState.selectedSeason).matches);
});

recentMatchLimitOptions.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        closeRecentMatchLimitPicker();
        recentMatchLimitButton.focus();
        return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const options = [...recentMatchLimitOptions.querySelectorAll('[data-match-limit]')];
    const currentIndex = options.indexOf(document.activeElement);
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    options[(currentIndex + offset + options.length) % options.length].focus();
});

document.addEventListener('click', event => {
    if (!recentMatchLimitPicker.contains(event.target)) closeRecentMatchLimitPicker();
});

document.addEventListener('focusin', event => {
    if (!recentMatchLimitPicker.contains(event.target)) closeRecentMatchLimitPicker();
});

function showMessage(message, type = 'success') {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = message;
    messageDiv.className = `message ${type}`;
    setTimeout(() => {
        messageDiv.className = 'message';
    }, 5000);
}

window.deletePlayer = async function(playerName) {
    if (!confirm(`Are you sure you want to delete ${playerName}? This cannot be undone.`)) return;
    try {
        await database.ref(`players/${playerName}`).remove();
        showMessage(`Player ${playerName} deleted`);
    } catch (error) {
        showMessage(`Error deleting player: ${error.message}`, 'error');
    }
};

window.deleteMatch = async function(matchId) {
    if (!confirm('Are you sure you want to delete this match? Season ratings will be recalculated.')) return;
    try {
        const projectedMatches = { ...appState.matches };
        delete projectedMatches[matchId];
        const updates = getCurrentSeasonPlayerUpdates(projectedMatches);
        updates[`matches/${matchId}`] = null;
        await database.ref().update(updates);
        showMessage('Match deleted and season ratings recalculated.');
    } catch (error) {
        showMessage(`Error deleting match: ${error.message}`, 'error');
    }
};

window.showInfo = function(type) {
    const info = {
        skill: {
            title: 'TrueSkill skill (μ)',
            description: 'Your estimated skill for the selected season. Everyone starts at 25.00, and a higher number means stronger results.'
        },
        uncertainty: {
            title: 'TrueSkill uncertainty (σ)',
            description: 'How uncertain the system is about your skill. Everyone starts at 8.33, and the number generally falls as they play more matches.'
        }
    };

    const selectedInfo = info[type];
    if (!selectedInfo) return;

    document.querySelector('.info-popup')?.remove();
    const popup = document.createElement('div');
    popup.className = 'info-popup';
    popup.innerHTML = `
        <div class="info-content" role="dialog" aria-modal="true" aria-labelledby="info-title">
            <div class="info-header">
                <h2 id="info-title">${selectedInfo.title}</h2>
                <button type="button" class="info-close" aria-label="Close">×</button>
            </div>
            <p>${selectedInfo.description}</p>
            <a class="info-link" href="https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/" target="_blank" rel="noopener">Learn about TrueSkill</a>
        </div>
    `;

    const closePopup = () => {
        document.removeEventListener('keydown', handleKeydown);
        document.body.classList.remove('modal-open');
        popup.remove();
    };
    const handleKeydown = event => {
        if (event.key === 'Escape') closePopup();
    };

    popup.querySelector('.info-close').addEventListener('click', closePopup);
    popup.addEventListener('click', event => {
        if (event.target === popup) closePopup();
    });
    document.addEventListener('keydown', handleKeydown);
    document.body.classList.add('modal-open');
    document.body.appendChild(popup);
    popup.querySelector('.info-close').focus();
};

if (isAdmin) {
    document.addEventListener('DOMContentLoaded', () => {
        const h1 = document.querySelector('h1');
        h1.insertAdjacentHTML('beforeend', ' <span style="color: red; font-size: 0.5em;">(Admin Mode)</span>');
    });
}

loadData();

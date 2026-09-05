// TrueSkill defaults for head-to-head and team matches.
const INITIAL_MU = 25;
const INITIAL_SIGMA = INITIAL_MU / 3;
const BETA = INITIAL_MU / 6;
const DYNAMICS_FACTOR = INITIAL_MU / 300;
const SEASON_START_MONTH = 9;
const HARVARD_TIME_ZONE = 'America/New_York';

const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('admin') === 'true';

const appState = {
    players: {},
    matches: {},
    selectedSeason: null,
    matchType: '1v1'
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

function updateRankings(players) {
    const rankingsDiv = document.getElementById('rankings');
    const entries = Object.entries(players);

    if (entries.length === 0) {
        rankingsDiv.innerHTML = '<p>No players competed in this season.</p>';
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
    const playerOptions = Object.keys(players)
        .sort()
        .map(name => `<option value="${escapeHtml(name)}"></option>`)
        .join('');

    document.getElementById('playerOptions').innerHTML = playerOptions;
}

function findPlayerName(value) {
    const normalizedValue = String(value || '').trim().toLocaleLowerCase();
    return Object.keys(appState.players).find(name =>
        name.toLocaleLowerCase() === normalizedValue
    );
}

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
        matchesDiv.innerHTML = '<p>No matches have been played in this season yet.</p>';
        return;
    }

    const sortedMatches = [...matches].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    matchesDiv.innerHTML = sortedMatches.map(match => {
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
            <div class="match-item">
                <div class="match-result">
                    <span class="match-team">${winnerDisplay}</span>
                    <span class="match-outcome">defeated</span>
                    <span class="match-team">${loserDisplay}</span>
                </div>
                <div class="match-meta">
                    <span class="match-date">${date}</span>
                    ${deleteButton}
                </div>
            </div>
        `;
    }).join('');
}

function render() {
    if (appState.selectedSeason === null) {
        appState.selectedSeason = getCurrentSeason();
    }

    const season = calculateSeason(appState.selectedSeason);

    renderSeasonTabs();
    document.getElementById('activeSeasonDates').textContent = getSeasonDateLabel(appState.selectedSeason);
    document.getElementById('rankingsTitle').textContent = 'Season Rankings';
    document.getElementById('seasonMatchCount').textContent = `${season.matches.length} ${season.matches.length === 1 ? 'match' : 'matches'}`;
    document.getElementById('matchesTitle').textContent = 'Season Matches';
    document.getElementById('submitMatchTitle').textContent = 'Submit Match Result';

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
        if (!isDoubles) input.value = '';
    });
    document.querySelector('label[for="winner1"]').textContent = isDoubles ? 'Player 1' : 'Player';
    document.querySelector('label[for="loser1"]').textContent = isDoubles ? 'Player 1' : 'Player';
}

document.querySelectorAll('[data-match-type]').forEach(button => {
    button.addEventListener('click', () => setMatchType(button.dataset.matchType));
});

document.getElementById('matchForm').addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const winnerTeam = [findPlayerName(formData.get('winner1'))];
    const loserTeam = [findPlayerName(formData.get('loser1'))];

    if (appState.matchType === '2v2') {
        winnerTeam.push(findPlayerName(formData.get('winner2')));
        loserTeam.push(findPlayerName(formData.get('loser2')));
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
    if (submitted) event.target.reset();
});

document.getElementById('playerForm').addEventListener('submit', async event => {
    event.preventDefault();
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

// Glicko-2 constants
const INITIAL_RATING = 1500;
const INITIAL_RD = 350;
const INITIAL_VOLATILITY = 0.06;
const TAU = 0.5; // System constant
const EPSILON = 0.000001;

// Check if admin mode is enabled
const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('admin') === 'true';

// Glicko-2 calculation functions
function g(phi) {
    return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
}

function E(mu, muJ, phiJ) {
    return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function calculateGlicko2(player1, player2, score1) {
    // Convert from Glicko-2 scale to internal scale
    const mu1 = (player1.rating - 1500) / 173.7178;
    const mu2 = (player2.rating - 1500) / 173.7178;
    const phi1 = player1.rd / 173.7178;
    const phi2 = player2.rd / 173.7178;
    const sigma = INITIAL_VOLATILITY; // Use fixed volatility

    // Step 3: Compute variance
    const gPhi2 = g(phi2);
    const gPhi1 = g(phi1);
    const E1 = E(mu1, mu2, phi2);
    const E2 = E(mu2, mu1, phi1);

    const v1 = 1 / (gPhi2 * gPhi2 * E1 * (1 - E1));
    const v2 = 1 / (gPhi1 * gPhi1 * E2 * (1 - E2));

    // Step 4: Compute delta
    const delta1 = v1 * gPhi2 * (score1 - E1);
    const delta2 = v2 * gPhi1 * ((1 - score1) - E2);

    // Step 6: Update rating deviation (skip volatility calculation)
    const phiStar1 = Math.sqrt(phi1 * phi1 + sigma * sigma);
    const phiStar2 = Math.sqrt(phi2 * phi2 + sigma * sigma);

    // Step 7: Update rating and RD
    const newPhi1 = 1 / Math.sqrt(1 / (phiStar1 * phiStar1) + 1 / v1);
    const newPhi2 = 1 / Math.sqrt(1 / (phiStar2 * phiStar2) + 1 / v2);
    const newMu1 = mu1 + newPhi1 * newPhi1 * gPhi2 * (score1 - E1);
    const newMu2 = mu2 + newPhi2 * newPhi2 * gPhi1 * ((1 - score1) - E2);

    // Step 8: Convert back to Glicko-2 scale
    return {
        player1: {
            rating: Math.round(173.7178 * newMu1 + 1500),
            rd: Math.round(173.7178 * newPhi1)
        },
        player2: {
            rating: Math.round(173.7178 * newMu2 + 1500),
            rd: Math.round(173.7178 * newPhi2)
        }
    };
}

function loadData() {
    database.ref('players').on('value', (snapshot) => {
        const players = snapshot.val() || {};
        updateRankings(players);
        updateRatingChart(players);
        updatePlayerSelects(players);
    });

    database.ref('matches').limitToLast(10).on('value', (snapshot) => {
        const matches = snapshot.val() || {};
        const matchesWithIds = Object.entries(matches).map(([id, match]) => ({
            ...match,
            id
        }));
        updateRecentMatches(matchesWithIds);
    });
}

function getPlayerRatingMetrics(player) {
    const rating = player.rating || player.elo || INITIAL_RATING;
    const rd = player.rd || INITIAL_RD;

    return {
        rating,
        rd,
        lowerBound: rating - rd,
        upperBound: rating + rd
    };
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));
}

function getNiceTickStep(range, targetTickCount = 6) {
    if (!Number.isFinite(range) || range <= 0) {
        return 10;
    }

    const roughStep = range / Math.max(1, targetTickCount - 1);
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const residual = roughStep / magnitude;

    let niceResidual = 1;
    if (residual >= 5) {
        niceResidual = 10;
    } else if (residual >= 2) {
        niceResidual = 5;
    } else if (residual >= 1) {
        niceResidual = 2;
    }

    return niceResidual * magnitude;
}

function updateRatingChart(players) {
    const chartDiv = document.getElementById('ratingChart');
    const tooltip = document.getElementById('ratingChartTooltip');

    if (!chartDiv) {
        return;
    }

    if (tooltip) {
        tooltip.classList.remove('is-visible');
        tooltip.style.left = '0px';
        tooltip.style.top = '0px';
    }

    if (Object.keys(players).length === 0) {
        chartDiv.innerHTML = '<p class="loading">Add players and matches to see the uncertainty chart.</p>';
        return;
    }

    const chartPlayers = Object.entries(players)
        .map(([name, player]) => ({
            name,
            ...getPlayerRatingMetrics(player)
        }))
        .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const margin = { top: 26, right: 26, bottom: 175, left: 76 };
    const height = 440;
    const plotWidth = Math.max(560, chartPlayers.length * 58);
    const width = margin.left + plotWidth + margin.right;
    const plotLeft = margin.left;
    const plotRight = width - margin.right;
    const plotTop = margin.top;
    const plotBottom = height - margin.bottom;
    const plotHeight = plotBottom - plotTop;

    const minValue = Math.min(...chartPlayers.map((player) => player.lowerBound));
    const maxValue = Math.max(...chartPlayers.map((player) => player.upperBound));
    const padding = Math.max(8, Math.ceil((maxValue - minValue) * 0.08) || 8);
    const paddedMin = minValue - padding;
    const paddedMax = maxValue + padding;
    const tickStep = getNiceTickStep(paddedMax - paddedMin);
    const niceMin = Math.floor(paddedMin / tickStep) * tickStep;
    const niceMax = Math.ceil(paddedMax / tickStep) * tickStep;
    const yRange = Math.max(tickStep, niceMax - niceMin);

    const xForIndex = (index) => {
        if (chartPlayers.length === 1) {
            return plotLeft + plotWidth / 2;
        }

        return plotLeft + (index * plotWidth) / (chartPlayers.length - 1);
    };

    const yForValue = (value) => plotBottom - ((value - niceMin) / yRange) * plotHeight;

    const ticks = [];
    for (let tickValue = niceMin; tickValue <= niceMax + tickStep / 2; tickValue += tickStep) {
        ticks.push(tickValue);
    }

    const horizontalGridLines = ticks.map((tickValue) => {
        const y = yForValue(tickValue);
        return `
            <g>
                <line class="chart-grid-line" x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}"></line>
                <text class="chart-tick-label" x="${plotLeft - 12}" y="${y + 4}" text-anchor="end">${tickValue}</text>
            </g>
        `;
    }).join('');

    const verticalGuides = chartPlayers.map((player, index) => {
        const x = xForIndex(index);
        return `<line class="chart-grid-line" x1="${x}" y1="${plotTop}" x2="${x}" y2="${plotBottom}"></line>`;
    }).join('');

    const pointGroups = chartPlayers.map((player, index) => {
        const x = xForIndex(index);
        const ratingY = yForValue(player.rating);
        const upperY = yForValue(player.upperBound);
        const lowerY = yForValue(player.lowerBound);
        const hitboxTop = Math.min(upperY, lowerY) - 8;
        const hitboxHeight = Math.abs(lowerY - upperY) + 16;
        const labelX = x - 4;
        const labelY = plotBottom + 10;
        const escapedName = escapeHtml(player.name);
        const titleText = `${player.name}: Score ${player.rating}, Upper Bound ${player.upperBound}, Lower Bound ${player.lowerBound}`;

        return `
            <g
                class="chart-point-group"
                data-player="${escapedName}"
                data-rating="${player.rating}"
                data-rd="${player.rd}"
                data-lower="${player.lowerBound}"
                data-upper="${player.upperBound}"
            >
                <title>${escapeHtml(titleText)}</title>
                <rect class="chart-point-hitbox" x="${x - 16}" y="${hitboxTop}" width="32" height="${hitboxHeight}" rx="8" ry="8"></rect>
                <line class="chart-error-bar" x1="${x}" y1="${upperY}" x2="${x}" y2="${lowerY}"></line>
                <line class="chart-error-cap" x1="${x - 7}" y1="${upperY}" x2="${x + 7}" y2="${upperY}"></line>
                <line class="chart-error-cap" x1="${x - 7}" y1="${lowerY}" x2="${x + 7}" y2="${lowerY}"></line>
                <circle class="chart-point" cx="${x}" cy="${ratingY}" r="4.5"></circle>
            </g>
            <text class="chart-point-label" x="${labelX}" y="${labelY}" text-anchor="start" dominant-baseline="hanging" transform="rotate(63 ${labelX} ${labelY})">${escapedName}</text>
        `;
    }).join('');

    chartDiv.innerHTML = `
        <svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-labelledby="ratingChartTitle">
            <title id="ratingChartTitle">Player ratings with uncertainty shown as Rating Deviation (RD)</title>
            ${horizontalGridLines}
            ${verticalGuides}
            <line class="chart-axis-line" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}"></line>
            <line class="chart-axis-line" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}"></line>
            ${pointGroups}
            <text class="chart-axis-title" x="${plotLeft + plotWidth / 2}" y="${height - 56}" text-anchor="middle">Players</text>
            <text class="chart-axis-title" x="24" y="${plotTop + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 24 ${plotTop + plotHeight / 2})">Rating</text>
        </svg>
    `;

    attachRatingChartInteractions();
}

function showRatingChartTooltip(group, event) {
    const chartDiv = document.getElementById('ratingChart');
    const tooltip = document.getElementById('ratingChartTooltip');

    if (!chartDiv || !tooltip) {
        return;
    }

    const playerName = group.dataset.player || '';
    const rating = group.dataset.rating || '';
    const rd = group.dataset.rd || '';
    const lowerBound = group.dataset.lower || '';
    const upperBound = group.dataset.upper || '';

    tooltip.innerHTML = `
        <strong>${escapeHtml(playerName)}</strong>
        <div>Score: ${rating}</div>
        <div>Upper Bound: ${upperBound}</div>
        <div>Lower Bound: ${lowerBound}</div>
    `;
    tooltip.classList.add('is-visible');

    const containerRect = chartDiv.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth || 220;
    const tooltipHeight = tooltip.offsetHeight || 100;
    const offsetX = event.clientX - containerRect.left + chartDiv.scrollLeft + 16;
    const offsetY = event.clientY - containerRect.top - tooltipHeight - 12;
    const maxLeft = chartDiv.scrollLeft + chartDiv.clientWidth - tooltipWidth - 12;
    const preferredLeft = Math.min(Math.max(chartDiv.scrollLeft + 12, offsetX), maxLeft);
    const preferredTop = offsetY < 12
        ? event.clientY - containerRect.top + 18
        : offsetY;

    tooltip.style.left = `${preferredLeft}px`;
    tooltip.style.top = `${preferredTop}px`;
}

function hideRatingChartTooltip() {
    const tooltip = document.getElementById('ratingChartTooltip');

    if (!tooltip) {
        return;
    }

    tooltip.classList.remove('is-visible');
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
}

function attachRatingChartInteractions() {
    const chartDiv = document.getElementById('ratingChart');

    if (!chartDiv) {
        return;
    }

    const hitTargets = chartDiv.querySelectorAll('.chart-point-hitbox');
    hitTargets.forEach((target) => {
        const group = target.closest('.chart-point-group');
        if (!group) {
            return;
        }

        target.addEventListener('pointerenter', (event) => {
            group.classList.add('is-hovered');
            showRatingChartTooltip(group, event);
        });

        target.addEventListener('pointermove', (event) => {
            showRatingChartTooltip(group, event);
        });

        target.addEventListener('pointerleave', () => {
            group.classList.remove('is-hovered');
            hideRatingChartTooltip();
        });
    });
}

function updateRankings(players) {
    const rankingsDiv = document.getElementById('rankings');

    if (Object.keys(players).length === 0) {
        rankingsDiv.innerHTML = '<p>No players yet. Add a player to get started!</p>';
        return;
    }

    const sortedPlayers = Object.entries(players)
        .sort((a, b) => (b[1].rating || b[1].elo || INITIAL_RATING) - (a[1].rating || a[1].elo || INITIAL_RATING));

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Player</th>
                    <th>
                        Rating
                        <span class="info-icon" onclick="showInfo('rating')">ⓘ</span>
                    </th>
                    <th>
                        RD
                        <span class="info-icon" onclick="showInfo('rd')">ⓘ</span>
                    </th>
                    <th>Win Rate</th>
                    ${isAdmin ? '<th>Action</th>' : ''}
                </tr>
            </thead>
            <tbody>
    `;

    sortedPlayers.forEach((([name, player], index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const winRate = player.matches > 0 ? ((player.wins / player.matches) * 100).toFixed(1) : '0.0';

        const rating = player.rating || player.elo || INITIAL_RATING;
        const rd = player.rd || INITIAL_RD;

        const deleteButton = isAdmin ? `<td><button class="delete-btn" onclick="deletePlayer('${name}')">Delete</button></td>` : '';

        html += `
            <tr>
                <td class="${rankClass}">${rank}</td>
                <td>${name}</td>
                <td>${rating}</td>
                <td>${rd}</td>
                <td>${winRate}%</td>
                ${deleteButton}
            </tr>
        `;
    }));

    html += `
            </tbody>
        </table>
    `;

    rankingsDiv.innerHTML = html;
}

function updatePlayerSelects(players) {
    const winnerSelect = document.getElementById('winner');
    const loserSelect = document.getElementById('loser');

    const playerOptions = Object.keys(players)
        .sort()
        .map(name => `<option value="${name}">${name}</option>`)
        .join('');

    winnerSelect.innerHTML = '<option value="">Select player</option>' + playerOptions;
    loserSelect.innerHTML = '<option value="">Select player</option>' + playerOptions;
}

function updateRecentMatches(matches) {
    const matchesDiv = document.getElementById('recentMatches');

    if (!matches || matches.length === 0) {
        matchesDiv.innerHTML = '<p>No matches played yet.</p>';
        return;
    }

    const sortedMatches = matches.sort((a, b) =>
        new Date(b.timestamp) - new Date(a.timestamp)
    );

    let html = '';
    sortedMatches.forEach(match => {
        const date = new Date(match.timestamp).toLocaleDateString();
        const deleteButton = isAdmin ? `<button class="delete-btn" onclick="deleteMatch('${match.id}')">Delete</button>` : '';

        // Support both old Elo and new Glicko-2 rating changes
        const winnerChange = (match.winnerRatingChange !== undefined) ?
            `<span style="color: #28a745; font-weight: bold;">(+${match.winnerRatingChange})</span>` :
            (match.winnerEloChange ?
                `<span style="color: #28a745; font-weight: bold;">(+${match.winnerEloChange})</span>` : '');

        const loserChange = (match.loserRatingChange !== undefined) ?
            `<span style="color: #dc3545; font-weight: bold;">(${match.loserRatingChange})</span>` :
            (match.loserEloChange ?
                `<span style="color: #dc3545; font-weight: bold;">(${match.loserEloChange})</span>` : '');

        html += `
            <div class="match-item">
                <div>
                    <strong>${match.winner}</strong> ${winnerChange} defeated <strong>${match.loser}</strong> ${loserChange}
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span class="match-date">${date}</span>
                    ${deleteButton}
                </div>
            </div>
        `;
    });

    matchesDiv.innerHTML = html;
}

function showMessage(message, type = 'success') {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = message;
    messageDiv.className = `message ${type}`;

    setTimeout(() => {
        messageDiv.className = 'message';
    }, 5000);
}

async function submitMatch(matchData) {
    try {
        const playersRef = database.ref('players');
        const snapshot = await playersRef.once('value');
        const players = snapshot.val() || {};

        let winner = players[matchData.winner];
        let loser = players[matchData.loser];

        if (!winner || !loser) {
            showMessage('Players not found. Please add them first.', 'error');
            return;
        }

        // Ensure players have Glicko-2 ratings
        if (!winner.rating) {
            winner = {
                ...winner,
                rating: winner.elo || INITIAL_RATING,
                rd: INITIAL_RD
            };
        }
        if (!loser.rating) {
            loser = {
                ...loser,
                rating: loser.elo || INITIAL_RATING,
                rd: INITIAL_RD
            };
        }

        const oldWinnerRating = winner.rating;
        const oldLoserRating = loser.rating;

        // Calculate new Glicko-2 ratings
        const newRatings = calculateGlicko2(winner, loser, 1); // Winner scored 1, loser scored 0

        const winnerChange = newRatings.player1.rating - oldWinnerRating;
        const loserChange = newRatings.player2.rating - oldLoserRating;

        await database.ref(`players/${matchData.winner}`).update({
            rating: newRatings.player1.rating,
            rd: newRatings.player1.rd,
            matches: (winner.matches || 0) + 1,
            wins: (winner.wins || 0) + 1
        });

        await database.ref(`players/${matchData.loser}`).update({
            rating: newRatings.player2.rating,
            rd: newRatings.player2.rd,
            matches: (loser.matches || 0) + 1,
            wins: loser.wins || 0
        });

        await database.ref('matches').push({
            ...matchData,
            winnerRatingChange: winnerChange,
            loserRatingChange: loserChange,
            timestamp: new Date().toISOString()
        });

        showMessage('Match submitted successfully!');
    } catch (error) {
        showMessage('Error submitting match: ' + error.message, 'error');
    }
}

document.getElementById('matchForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const winner = formData.get('winner');
    const loser = formData.get('loser');

    if (winner === loser) {
        showMessage('Winner and loser must be different players', 'error');
        return;
    }

    await submitMatch({
        winner,
        loser
    });

    e.target.reset();
});

document.getElementById('playerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
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
            rating: INITIAL_RATING,
            rd: INITIAL_RD,
            matches: 0,
            wins: 0
        });

        showMessage(`Player ${playerName} added successfully!`);
        e.target.reset();
    } catch (error) {
        showMessage('Error adding player: ' + error.message, 'error');
    }
});

// Function to recalculate all ratings from match history
async function recalculateAllRatings() {
    try {
        // Get all matches and players
        const matchesSnapshot = await database.ref('matches').once('value');
        const playersSnapshot = await database.ref('players').once('value');

        const matches = matchesSnapshot.val() || {};
        const players = playersSnapshot.val() || {};

        // Reset all players to initial values
        const resetPlayers = {};
        Object.keys(players).forEach(name => {
            resetPlayers[name] = {
                rating: INITIAL_RATING,
                rd: INITIAL_RD,
                matches: 0,
                wins: 0
            };
        });

        // Sort matches by timestamp
        const sortedMatches = Object.entries(matches)
            .map(([id, match]) => ({ ...match, id }))
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // Replay all matches in chronological order
        for (const match of sortedMatches) {
            const winner = resetPlayers[match.winner];
            const loser = resetPlayers[match.loser];

            if (!winner || !loser) continue; // Skip if player doesn't exist

            // Calculate new ratings
            const newRatings = calculateGlicko2(winner, loser, 1);

            // Update winner
            resetPlayers[match.winner] = {
                ...newRatings.player1,
                matches: winner.matches + 1,
                wins: winner.wins + 1
            };

            // Update loser
            resetPlayers[match.loser] = {
                ...newRatings.player2,
                matches: loser.matches + 1,
                wins: loser.wins
            };

            // Update the match with new rating changes
            const winnerChange = newRatings.player1.rating - winner.rating;
            const loserChange = newRatings.player2.rating - loser.rating;

            await database.ref(`matches/${match.id}`).update({
                winnerRatingChange: winnerChange,
                loserRatingChange: loserChange
            });
        }

        // Update all players in database
        const updates = {};
        Object.entries(resetPlayers).forEach(([name, player]) => {
            updates[`players/${name}`] = player;
        });

        await database.ref().update(updates);

        return true;
    } catch (error) {
        console.error('Error recalculating ratings:', error);
        throw error;
    }
}

// Admin functions
window.deletePlayer = async function(playerName) {
    if (confirm(`Are you sure you want to delete ${playerName}? This cannot be undone.`)) {
        try {
            await database.ref(`players/${playerName}`).remove();
            showMessage(`Player ${playerName} deleted`);
        } catch (error) {
            showMessage('Error deleting player: ' + error.message, 'error');
        }
    }
};

window.deleteMatch = async function(matchId) {
    if (confirm('Are you sure you want to delete this match? Ratings will be recalculated from match history.')) {
        try {
            // Delete the match first
            await database.ref(`matches/${matchId}`).remove();

            // Show immediate feedback
            showMessage('Match deleted, recalculating ratings...');

            // Recalculate all ratings
            await recalculateAllRatings();

            showMessage('Match deleted and ratings recalculated successfully!');
        } catch (error) {
            showMessage('Error: ' + error.message, 'error');
        }
    }
};

// Info popup function
window.showInfo = function(type) {
    let message = '';
    switch(type) {
        case 'rating':
            message = 'Glicko-2 rating: Your skill level (1500 = average). Higher is better! <a href="https://en.wikipedia.org/wiki/Glicko_rating_system" target="_blank" style="color: #5d7c4f;">Learn more →</a>';
            break;
        case 'rd':
            message = 'Rating Deviation: How uncertain your rating is (0-350). Lower = more accurate rating.';
            break;
    }

    // Create popup
    const popup = document.createElement('div');
    popup.className = 'info-popup';
    popup.innerHTML = `
        <div class="info-content">
            ${message}
            <button onclick="this.parentElement.parentElement.remove()">Got it</button>
        </div>
    `;
    document.body.appendChild(popup);
};

// Show admin mode indicator if active
if (isAdmin) {
    document.addEventListener('DOMContentLoaded', () => {
        const h1 = document.querySelector('h1');
        h1.innerHTML += ' <span style="color: red; font-size: 0.5em;">(Admin Mode)</span>';
    });
}

loadData();

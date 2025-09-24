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
    const sigma1 = player1.volatility;
    const sigma2 = player2.volatility;

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

    // Step 5: Calculate new volatility using Illinois algorithm
    function calculateNewVolatility(sigma, phi, v, delta) {
        const a = Math.log(sigma * sigma);
        const phiSq = phi * phi;
        const deltaSq = delta * delta;

        const f = function(x) {
            const ex = Math.exp(x);
            const num = ex * (deltaSq - phiSq - v - ex);
            const denom = 2 * Math.pow(phiSq + v + ex, 2);
            return num / denom - (x - a) / (TAU * TAU);
        };

        let A = a;
        let B;
        if (deltaSq > phiSq + v) {
            B = Math.log(deltaSq - phiSq - v);
        } else {
            let k = 1;
            while (f(a - k * TAU) < 0) k++;
            B = a - k * TAU;
        }

        let fA = f(A);
        let fB = f(B);

        while (Math.abs(B - A) > EPSILON) {
            const C = A + (A - B) * fA / (fB - fA);
            const fC = f(C);

            if (fC * fB < 0) {
                A = B;
                fA = fB;
            } else {
                fA = fA / 2;
            }

            B = C;
            fB = fC;
        }

        return Math.exp(A / 2);
    }

    const newSigma1 = calculateNewVolatility(sigma1, phi1, v1, delta1);
    const newSigma2 = calculateNewVolatility(sigma2, phi2, v2, delta2);

    // Step 6: Update rating deviation
    const phiStar1 = Math.sqrt(phi1 * phi1 + newSigma1 * newSigma1);
    const phiStar2 = Math.sqrt(phi2 * phi2 + newSigma2 * newSigma2);

    // Step 7: Update rating and RD
    const newPhi1 = 1 / Math.sqrt(1 / (phiStar1 * phiStar1) + 1 / v1);
    const newPhi2 = 1 / Math.sqrt(1 / (phiStar2 * phiStar2) + 1 / v2);
    const newMu1 = mu1 + newPhi1 * newPhi1 * gPhi2 * (score1 - E1);
    const newMu2 = mu2 + newPhi2 * newPhi2 * gPhi1 * ((1 - score1) - E2);

    // Step 8: Convert back to Glicko-2 scale
    return {
        player1: {
            rating: Math.round(173.7178 * newMu1 + 1500),
            rd: Math.round(173.7178 * newPhi1),
            volatility: newSigma1
        },
        player2: {
            rating: Math.round(173.7178 * newMu2 + 1500),
            rd: Math.round(173.7178 * newPhi2),
            volatility: newSigma2
        }
    };
}

function loadData() {
    database.ref('players').on('value', (snapshot) => {
        const players = snapshot.val() || {};
        updateRankings(players);
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
                    <th>
                        Vol
                        <span class="info-icon" onclick="showInfo('vol')">ⓘ</span>
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
        const volatility = player.volatility || INITIAL_VOLATILITY;

        const deleteButton = isAdmin ? `<td><button class="delete-btn" onclick="deletePlayer('${name}')">Delete</button></td>` : '';

        html += `
            <tr>
                <td class="${rankClass}">${rank}</td>
                <td>${name}</td>
                <td>${rating}</td>
                <td>${rd}</td>
                <td>${volatility.toFixed(4)}</td>
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
                rd: INITIAL_RD,
                volatility: INITIAL_VOLATILITY
            };
        }
        if (!loser.rating) {
            loser = {
                ...loser,
                rating: loser.elo || INITIAL_RATING,
                rd: INITIAL_RD,
                volatility: INITIAL_VOLATILITY
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
            volatility: newRatings.player1.volatility,
            matches: (winner.matches || 0) + 1,
            wins: (winner.wins || 0) + 1
        });

        await database.ref(`players/${matchData.loser}`).update({
            rating: newRatings.player2.rating,
            rd: newRatings.player2.rd,
            volatility: newRatings.player2.volatility,
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
            volatility: INITIAL_VOLATILITY,
            matches: 0,
            wins: 0
        });

        showMessage(`Player ${playerName} added successfully!`);
        e.target.reset();
    } catch (error) {
        showMessage('Error adding player: ' + error.message, 'error');
    }
});

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
    if (confirm('Are you sure you want to delete this match? This will NOT recalculate Glicko-2 ratings.')) {
        try {
            await database.ref(`matches/${matchId}`).remove();
            showMessage('Match deleted');
        } catch (error) {
            showMessage('Error deleting match: ' + error.message, 'error');
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
        case 'vol':
            message = 'Volatility: How consistent you are (0.06 = normal). Lower = more predictable performance.';
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
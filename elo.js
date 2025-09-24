const K_FACTOR = 32;
const INITIAL_ELO = 1200;

// Check if admin mode is enabled
const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('admin') === 'true';

function calculateElo(winnerElo, loserElo) {
    const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

    const newWinnerElo = winnerElo + K_FACTOR * (1 - expectedWinner);
    const newLoserElo = loserElo + K_FACTOR * (0 - expectedLoser);

    return {
        winner: Math.round(newWinnerElo),
        loser: Math.round(newLoserElo)
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
        .sort((a, b) => b[1].elo - a[1].elo);

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Player</th>
                    <th>Elo</th>
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

        const deleteButton = isAdmin ? `<td><button class="delete-btn" onclick="deletePlayer('${name}')">Delete</button></td>` : '';

        html += `
            <tr>
                <td class="${rankClass}">${rank}</td>
                <td>${name}</td>
                <td>${player.elo}</td>
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
        html += `
            <div class="match-item">
                <div>
                    <strong>${match.winner}</strong> defeated <strong>${match.loser}</strong>
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

        const newElos = calculateElo(winner.elo, loser.elo);

        await database.ref(`players/${matchData.winner}`).update({
            elo: newElos.winner,
            matches: (winner.matches || 0) + 1,
            wins: (winner.wins || 0) + 1
        });

        await database.ref(`players/${matchData.loser}`).update({
            elo: newElos.loser,
            matches: (loser.matches || 0) + 1,
            wins: loser.wins || 0
        });

        await database.ref('matches').push({
            ...matchData,
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
            elo: INITIAL_ELO,
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
    if (confirm('Are you sure you want to delete this match? This will NOT recalculate Elo ratings.')) {
        try {
            await database.ref(`matches/${matchId}`).remove();
            showMessage('Match deleted');
        } catch (error) {
            showMessage('Error deleting match: ' + error.message, 'error');
        }
    }
};

// Show admin mode indicator if active
if (isAdmin) {
    document.addEventListener('DOMContentLoaded', () => {
        const h1 = document.querySelector('h1');
        h1.innerHTML += ' <span style="color: red; font-size: 0.5em;">(Admin Mode)</span>';
    });
}

loadData();
let data = {
    players: {},
    matches: []
};

const K_FACTOR = 32;
const INITIAL_ELO = 1200;

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

async function loadData() {
    try {
        const response = await fetch('data.json');
        if (response.ok) {
            data = await response.json();
        } else {
            console.log('No data file found, using defaults');
        }
    } catch (error) {
        console.log('Error loading data:', error);
    }
    updateUI();
}

function updateUI() {
    updateRankings();
    updatePlayerSelects();
    updateRecentMatches();
}

function updateRankings() {
    const rankingsDiv = document.getElementById('rankings');

    if (Object.keys(data.players).length === 0) {
        rankingsDiv.innerHTML = '<p>No players yet. Add a player to get started!</p>';
        return;
    }

    const sortedPlayers = Object.entries(data.players)
        .sort((a, b) => b[1].elo - a[1].elo);

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Player</th>
                    <th>Elo</th>
                    <th>Matches</th>
                    <th>Wins</th>
                    <th>Win Rate</th>
                </tr>
            </thead>
            <tbody>
    `;

    sortedPlayers.forEach((([name, player], index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const winRate = player.matches > 0 ? ((player.wins / player.matches) * 100).toFixed(1) : '0.0';

        html += `
            <tr>
                <td class="${rankClass}">${rank}</td>
                <td>${name}</td>
                <td>${player.elo}</td>
                <td>${player.matches}</td>
                <td>${player.wins}</td>
                <td>${winRate}%</td>
            </tr>
        `;
    }));

    html += `
            </tbody>
        </table>
    `;

    rankingsDiv.innerHTML = html;
}

function updatePlayerSelects() {
    const winnerSelect = document.getElementById('winner');
    const loserSelect = document.getElementById('loser');

    const playerOptions = Object.keys(data.players)
        .sort()
        .map(name => `<option value="${name}">${name}</option>`)
        .join('');

    winnerSelect.innerHTML = '<option value="">Select player</option>' + playerOptions;
    loserSelect.innerHTML = '<option value="">Select player</option>' + playerOptions;
}

function updateRecentMatches() {
    const matchesDiv = document.getElementById('recentMatches');

    if (data.matches.length === 0) {
        matchesDiv.innerHTML = '<p>No matches played yet.</p>';
        return;
    }

    const recentMatches = data.matches.slice(-10).reverse();

    let html = '';
    recentMatches.forEach(match => {
        const date = new Date(match.timestamp).toLocaleDateString();
        html += `
            <div class="match-item">
                <div>
                    <strong>${match.winner}</strong> defeated <strong>${match.loser}</strong>
                    <span class="match-score">${match.winnerScore}-${match.loserScore}</span>
                </div>
                <div class="match-date">${date}</div>
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
    const apiUrl = 'https://api.github.com/repos/' + window.location.pathname.split('/')[1] + '/' + window.location.pathname.split('/')[2] + '/dispatches';

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': 'token ' + prompt('Please enter your GitHub personal access token (with repo scope):')
            },
            body: JSON.stringify({
                event_type: 'update_match',
                client_payload: matchData
            })
        });

        if (response.ok) {
            showMessage('Match submitted! Rankings will update shortly.');

            const winner = data.players[matchData.winner];
            const loser = data.players[matchData.loser];
            const newElos = calculateElo(winner.elo, loser.elo);

            winner.elo = newElos.winner;
            winner.matches++;
            winner.wins++;

            loser.elo = newElos.loser;
            loser.matches++;

            data.matches.push({
                ...matchData,
                timestamp: new Date().toISOString()
            });

            updateUI();
        } else {
            throw new Error('Failed to submit match');
        }
    } catch (error) {
        showMessage('For now, matches are stored locally. To persist data, set up the GitHub Action.', 'error');

        const winner = data.players[matchData.winner];
        const loser = data.players[matchData.loser];
        const newElos = calculateElo(winner.elo, loser.elo);

        winner.elo = newElos.winner;
        winner.matches++;
        winner.wins++;

        loser.elo = newElos.loser;
        loser.matches++;

        data.matches.push({
            ...matchData,
            timestamp: new Date().toISOString()
        });

        updateUI();

        localStorage.setItem('pingpongData', JSON.stringify(data));
    }
}

document.getElementById('matchForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const winner = formData.get('winner');
    const loser = formData.get('loser');
    const winnerScore = parseInt(formData.get('winnerScore'));
    const loserScore = parseInt(formData.get('loserScore'));

    if (winner === loser) {
        showMessage('Winner and loser must be different players', 'error');
        return;
    }

    await submitMatch({
        winner,
        loser,
        winnerScore,
        loserScore
    });

    e.target.reset();
});

document.getElementById('playerForm').addEventListener('submit', (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const playerName = formData.get('playerName').trim();

    if (!playerName) {
        showMessage('Please enter a valid player name', 'error');
        return;
    }

    if (data.players[playerName]) {
        showMessage('Player already exists', 'error');
        return;
    }

    data.players[playerName] = {
        elo: INITIAL_ELO,
        matches: 0,
        wins: 0
    };

    updateUI();
    showMessage(`Player ${playerName} added successfully!`);

    localStorage.setItem('pingpongData', JSON.stringify(data));

    e.target.reset();
});

const savedData = localStorage.getItem('pingpongData');
if (savedData) {
    data = JSON.parse(savedData);
}

loadData();
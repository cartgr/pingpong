const fs = require('fs');

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

function updateData(matchData) {
    // Read current data
    let data;
    try {
        const fileContent = fs.readFileSync('data.json', 'utf8');
        data = JSON.parse(fileContent);
    } catch (error) {
        console.log('Creating new data file');
        data = {
            players: {},
            matches: []
        };
    }

    // Ensure players exist
    if (!data.players[matchData.winner]) {
        data.players[matchData.winner] = {
            elo: INITIAL_ELO,
            matches: 0,
            wins: 0
        };
    }

    if (!data.players[matchData.loser]) {
        data.players[matchData.loser] = {
            elo: INITIAL_ELO,
            matches: 0,
            wins: 0
        };
    }

    // Calculate new Elo ratings
    const winner = data.players[matchData.winner];
    const loser = data.players[matchData.loser];
    const newElos = calculateElo(winner.elo, loser.elo);

    // Update winner
    winner.elo = newElos.winner;
    winner.matches++;
    winner.wins++;

    // Update loser
    loser.elo = newElos.loser;
    loser.matches++;

    // Add match to history
    data.matches.push({
        winner: matchData.winner,
        loser: matchData.loser,
        winnerScore: parseInt(matchData.winnerScore),
        loserScore: parseInt(matchData.loserScore),
        timestamp: new Date().toISOString()
    });

    // Write updated data
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
    console.log('Data updated successfully');
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length > 0) {
    let matchData = {};

    // Try to parse as JSON first (from repository_dispatch)
    try {
        const payload = JSON.parse(args[0]);
        if (payload && payload.winner) {
            matchData = payload;
        } else if (args[1]) {
            // Try workflow_dispatch inputs
            const inputs = JSON.parse(args[1]);
            if (inputs && inputs.winner) {
                matchData = inputs;
            }
        }
    } catch (error) {
        console.error('Error parsing input:', error);
        process.exit(1);
    }

    if (matchData.winner && matchData.loser) {
        updateData(matchData);
    } else {
        console.error('Missing required match data');
        process.exit(1);
    }
} else {
    console.log('No match data provided');
    process.exit(1);
}
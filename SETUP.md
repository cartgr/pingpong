# 🏓 Ping Pong Tracker Setup (5 minutes)

## Quick Setup with Firebase (FREE)

### 1. Create Firebase Project (2 min)
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project"
3. Name it (e.g., "pingpong-tracker")
4. Disable Google Analytics (not needed)
5. Click "Create Project"

### 2. Enable Database (1 min)
1. In your project, click "Realtime Database" in left menu
2. Click "Create Database"
3. Choose location (United States is fine)
4. Select "Start in TEST mode" (important!)
5. Click "Enable"

### 3. Get Your Config (1 min)
1. Click the gear icon ⚙️ → "Project settings"
2. Scroll down to "Your apps"
3. Click the `</>` web icon
4. Register app with nickname (e.g., "pingpong-web")
5. Copy the config object that appears

### 4. Update Your Code (1 min)
1. Open `index.html` in your repo
2. Find the `firebaseConfig` section (around line 78)
3. Replace the placeholder values with your config:

```javascript
const firebaseConfig = {
    apiKey: "your-actual-api-key",
    authDomain: "your-project.firebaseapp.com",
    databaseURL: "https://your-project.firebaseio.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "your-app-id"
};
```

### 5. Deploy
```bash
git add .
git commit -m "Add Firebase config"
git push
```

### 6. GitHub Pages Setup
1. Go to your repo Settings → Pages
2. Source: "Deploy from branch"
3. Branch: main, folder: / (root)
4. Save

## 🎮 How to Use

### Your site will be at:
`https://[your-github-username].github.io/pingpong/`

### Anyone can now:
1. **Add players**: Enter name in "Add New Player" form
2. **Submit matches**: Select winner/loser and scores
3. **View rankings**: Live Elo rankings update instantly

### Features:
- Real-time updates (everyone sees changes instantly)
- No login required
- Works on phones
- Free forever (Firebase free tier = 100k reads/day)

## 🔒 Security Note
The test mode database is open for 30 days. After that:
1. Go to Firebase Console → Realtime Database → Rules
2. Update rules to allow read/write (keep it simple):
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

That's it! Share the link with your lab mates and start tracking! 🏓
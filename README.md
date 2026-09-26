# Wondering Workers

A browser inspired, fully vibe-coded version of "Ricochet robots". It is a
static website. Firebase Realtime Database keeps the calls, the timer, and the
moves in sync between players.

## How a round works

1. A target is drawn. Everyone looks for the shortest path that brings the
   worker of that color onto it. Any worker may move, including the black one
   and the optional white one, which have no targets of their own.
2. You call a number by tapping it on the number pad. On a keyboard you can
   type the number and press Enter. The pad starts at 5, since shorter
   targets are never drawn.
3. The first call starts a 60 second timer. You can change your call while the
   timer runs. A changed call gets a new time stamp. So if you call 5, a
   friend calls 6, and you then change to 6, your friend's 6 comes first.
4. If you take back your call and nobody else has called, the timer stops. It
   starts again from 60 seconds on the next call. If someone else has called,
   the timer keeps running.
5. A call of 5 can't be beaten. When someone calls 5, the timer runs out 5
   seconds later, so nobody has to wait the full minute. If they take the 5
   back, the normal timer applies again.
6. When the timer runs out, the lowest call shows their moves. Ties go to
   whoever made that call first. They drag workers on the board, and everyone
   else watches the moves happen live.
7. The person showing their moves may use more moves than they called, as
   long as they still beat the next caller in line. So their limit is one
   less than the next call, and never below their own call. With calls of 9
   and 13, the 9 caller may use up to 12 moves. With two calls of 9, the
   limit stays at 9. A call of 5 is the exception. It cut everyone's
   thinking time, so a 5 must be made in 5 moves. Reaching the target within
   the limit wins the token. If they give up, the workers go back and the
   next caller tries.
8. Whoever has nobody behind them in line takes the token as long as they
   reach the target, even if they miscounted in either direction. The
   exception is a single call of 5 that turns out to need more moves. That
   call cut everyone's timer short, so nobody scores and the target goes
   back in the pile. If it was the last target that could still be played,
   the caller keeps the token.
9. The workers stay where they ended after a win.

Targets that can be reached in 4 moves or fewer are never drawn. The game ends
when all 16 targets are won, or when every target that is left can be reached
in 4 moves or fewer.

### The portal

The multicolor swirl appears twice on the board. The two swirls are the two
ends of a portal.

- A worker that slides onto one end comes out of the other end, moving in the
  same direction, and keeps sliding. Entering from the top means leaving
  through the bottom.
- If the cell right after the far end is blocked, the worker stops on the far
  end.
- If another worker sits on the far end, the moving worker stops on the end it
  entered.
- A worker that stands on an end simply moves off it. It has to leave the
  portal before it can use it.

### Diagonal walls

When you create a room or start a new board, you pick how many quadrants
get colored diagonal walls, from 0 to 4. The default is 2. Which quadrants get
them is random, and each of those quadrants gets two diagonals.
A worker of a different color bounces off a diagonal at a right angle and keeps
sliding. A worker of the same color passes straight through. The black worker
always bounces. A worker that starts on a diagonal moves off it in a straight
line.

### The white worker

When you create a room or start a new board, you can add a white worker. It
passes straight through every diagonal, whatever its color. Normal walls stop
it like any other worker. Like the black worker, it never has a target.

### Who called first

The server decides who called first. Every call gets the time it reached the
Firebase server, and the security rules reject calls with any other time. A
friend with a slow connection is still a bit behind, but nobody can fake it.

### Game modes

When you create a room or start a new board, you pick a game mode. For now
there is one mode, **Classic**, which plays by all the rules above. The header
shows the mode of the current board.

### Changing your name

Click **Edit** next to your own name in the player list, type a new name, and
press Enter. Everyone sees the new name straight away in the player list and
the calls. Chat messages you already sent keep the old name.

### Spotting the target

When a new target is drawn, the target square and the worker that has to
reach it send out a few rings in the target's color. After that, the target
square keeps a colored border and the worker keeps a ring in its own color
until the round ends. Tap the center block or the target icon above the
calls to see the rings again.

## Setup

There are two parts. Firebase holds the shared game data, and GitHub Pages
serves the website. Both are free for this.

### Part 1: Firebase

1. Go to <https://console.firebase.google.com> and sign in with a Google
   account. Click **Create a project** and give it a name, for example
   `ricochet-friends`. You can turn off Google Analytics and Gemini. Wait
   until the project is ready.
2. In the left menu, find **Realtime Database**. Depending on the console
   version it is under **Build** or under **Databases & storage**. Click
   **Create Database**.
3. Pick **Belgium (europe-west1)** as the location. Pick **Start in locked
   mode**, and click **Enable**.
4. Open the **Rules** tab of the database. Delete what is there, paste in the
   contents of `database.rules.json`, and click **Publish**.
5. Click the gear icon next to **Project Overview** and open **Project
   settings**. Under **Your apps**, click the web icon `</>`. Give the app a
   nickname. Leave **Firebase Hosting** unticked, and click **Register app**.
6. The page now shows a block of code with `const firebaseConfig = { ... }`.
   Copy the values of `apiKey`, `authDomain`, `databaseURL`, `projectId`, and
   `appId` into `config.js`. If `databaseURL` is missing, copy it from the
   top of the **Data** tab of the Realtime Database. It looks like
   `https://<project>-default-rtdb.europe-west1.firebasedatabase.app`.
7. Check it on your own computer. In this folder run
   `python3 -m http.server 8000` and open `http://localhost:8000/`. The
   lobby should no longer say "Local test mode". Create a room, and a
   `rooms` entry should appear in the **Data** tab in the Firebase console.

The API key in `config.js` is meant to be public. The database rules are what
protect the data. The free Spark plan allows 100 players connected at once,
which is far more than a group of friends needs.

### Part 2: GitHub Pages

GitHub Pages is free for public repositories.

1. Go to <https://github.com/new>. Name the repository `worker`, make it
   **Public**, and click **Create repository**.
2. Put the files in the repository. You can do this in the browser or with
   git.
   - In the browser: on the new repository page, click **uploading an
     existing file**. Drag in all the files from this folder. They all sit
     together at the top level, next to `index.html`. Click **Commit
     changes**.
   - With git, from inside this folder:

     ```sh
     git init -b main
     git add .
     git commit -m "Ricochet"
     git remote add origin https://github.com/<user>/worker.git
     git push -u origin main
     ```

3. In the repository, open **Settings > Pages**. Under **Build and
   deployment**, set **Source** to **Deploy from a branch**. Pick the `main`
   branch and the `/ (root)` folder, and click **Save**.
4. After a minute or two the site is live at
   `https://<user>.github.io/worker/`. The **Actions** tab shows the
   progress.

To update the site later, change the files and commit them again, or upload
them again in the browser. GitHub Pages redeploys on its own. If your browser
still shows the old version, reload with Ctrl+Shift+R.

GitHub may warn you that the repository contains a Google API key. For
Firebase web apps this is expected. If you want extra safety, open the
[Google Cloud credentials page](https://console.cloud.google.com/apis/credentials)
for the project, open the browser key, and under **Website restrictions** add
`https://<user>.github.io/*` and `http://localhost:8000/*`.

### Part 3: Play

Open the site, type a name, pick the board options, and click **Create a
room**. Click **Copy invite link** and send it to your friends. Each friend
opens the link and types a name.

### If something does not work

- The lobby says "Local test mode": `config.js` still has a `PASTE`
  value in it.
- Nothing happens after **Create a room**, and the browser console shows
  `permission_denied`: the rules from `database.rules.json` were not
  published.
- The browser console shows a connection error: `databaseURL` is wrong.
  Copy it again from the **Data** tab.

## Testing without Firebase

While `config.js` still has the placeholder values, the site runs in local
test mode. In local mode the game data lives in the browser, so every tab is a
separate player.

ES modules do not load from `file://`, so you need a small web server:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/?local&timer=10` in two or more tabs. The
`timer` value sets the timer in seconds. It only works in local mode.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | Page layout for the lobby and the game |
| `board.js` | Board generator, worker movement (portal and diagonals included), and the search that finds short targets |
| `game.js` | Rules for calls, the timer, and who shows their moves |
| `main.js` | Drawing, input, and sending actions to the database |
| `backend-firebase.js` | Firebase Realtime Database connection |
| `backend-local.js` | Local test mode that stores data in the browser |
| `config.js` | Your Firebase settings |
| `database.rules.json` | Security rules for the database |

## Notes

- Boards are random, but in the style of the physical game. Each quadrant has
  four targets in L-shaped wall corners. The four L's in a quadrant each face
  a different way. The first portal end also sits in
  such a corner. The second end is on an open cell in another quadrant, and
  never in the same row or column as the first.
- The short walls on the board edge never touch the walls around a target or
  the portal, so no cell becomes a pocket with a single way out.
- Boards where a worker could bounce around forever between diagonals or
  through the portal are thrown away.
- Anyone in the room can skip a target before the first call, and anyone can
  start a new board.
- If the person showing their moves goes offline, the others can move on to
  the next caller.
- **Clear offline** under the player list removes players who are offline and
  hold no tokens on the current board. Players with tokens stay, so the
  scores remain right.
- The chat under the player list shows only messages sent after you opened
  the room. Messages older than 30 minutes, or beyond the newest 50, are
  deleted whenever someone sends a new one.
- Anyone who knows a room code can write to that room. That is fine for a
  friend group. Old rooms stay in the database, but they are tiny.

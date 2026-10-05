# How to Set Up and Run the Tests

## Step 1 — Install Jest (testing framework)

Open PowerShell and run:

```
cd C:\Users\trevo\dutch-online\server
npm install --save-dev jest
```

---

## Step 2 — Create the tests folder

```
mkdir C:\Users\trevo\dutch-online\server\tests
```

Then copy the two test files into it:
- `gameLogic.test.js`   → `C:\Users\trevo\dutch-online\server\tests\gameLogic.test.js`
- `integration.test.js` → `C:\Users\trevo\dutch-online\server\tests\integration.test.js`

---

## Step 3 — Update server/package.json

Open `C:\Users\trevo\dutch-online\server\package.json` and add this:

```json
{
  "scripts": {
    "start": "node index.js",
    "test": "jest"
  },
  "jest": {
    "testTimeout": 15000
  }
}
```

---

## Step 4 — Export functions from server/index.js (for integration tests)

Add these lines at the very bottom of `C:\Users\trevo\dutch-online\server\index.js`:

```js
// Export for testing
if (process.env.NODE_ENV === 'test') {
  module.exports = { httpServer: server };
}
```

And make sure the `app.listen(...)` result is stored in a variable called `server`:
```js
// Find this line near the bottom of index.js:
//   app.listen(PORT, () => { ... })
// Change it to:
const server = require('http').createServer(app);
// ... (your socket.io setup should already use this)
// Then at the bottom:
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
```

---

## Step 5 — Run the unit tests (no server needed)

```
cd C:\Users\trevo\dutch-online\server
npm test -- tests/gameLogic.test.js
```

You should see output like:
```
PASS  tests/gameLogic.test.js
  makeDeck()
    ✓ produces exactly 52 cards
    ✓ contains all 4 suits
    ...
  cardValue()
    ✓ Ace = 1
    ✓ Red King (hearts) = 0
    ...
```

---

## Step 6 — Run the integration tests (server must NOT be running)

```
cd C:\Users\trevo\dutch-online\server
npm test -- tests/integration.test.js
```

The integration tests start their own server on port 3001 automatically.
Make sure your regular server is stopped first (so port 3001 is free).

---

## Run ALL tests at once

```
cd C:\Users\trevo\dutch-online\server
npm test
```

---

## Manual Testing

Open `MANUAL_QA_CHECKLIST.md` and go through each checkbox in your browser.
Open 2–4 tabs at `http://localhost:5173` and use different room IDs to test multiplayer.

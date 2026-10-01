# Storyboard Maker

A browser app for building storyboards from your own images. Add frames, fill in the shot details, reframe each image, draw arrows, add a cover page, and export a PDF. You can also send clients a link where they comment, suggest text edits and discuss the feedback with your team.

Nothing to install and no build step. It's plain HTML, CSS and JavaScript.

## Features

**Building the storyboard**
- **Images become frames.** Click *Add images*, or drop image files anywhere on the page. Each image becomes one frame, added in filename order (`01.jpg`, `02.jpg`, … `10.jpg`). You can also paste an image from the clipboard or add a blank frame.
- **Automatic numbering.** Frames are numbered by position and renumber themselves whenever you reorder.
- **Reordering.** Drag cards on the board. With the keyboard, focus a card and press <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd>. In the frame editor, use *Move earlier* / *Move later*.
- **Text fields.** Each frame has Setting, Shot type, Action, Voiceover, Dialogue and Notes. Use *Fields* to add, rename, reorder or remove fields, and choose single-line or multi-line for each. **Empty fields are hidden** on the board, in PDFs and on client links. Single-line fields suggest values you've already used (handy for repeating settings), and Shot type offers standard shot names.
- **One aspect ratio for the whole board.** Choose from 16:9, 1.85:1, 2.39:1, 2:1, 4:3, 3:2, 1:1, 4:5 and 9:16 in the top bar.
- **Reframe and crop.** In the frame editor's *Reframe* tool, drag to reposition and scroll (or use the slider) to zoom. *Fit* shows the whole image letterboxed, *Fill* fills the frame, and *Flip* mirrors the image. The parts of the image outside the frame stay faintly visible while you work.
- **Arrows.** In the *Arrows* tool, drag on the frame to draw an arrow. You can set its color (presets or any custom color), thickness, arrowheads (end, start, both or none), curve, solid or dashed line, and an optional outline. *Reverse* flips the direction. Drag the round handles to move the ends and the diamond to bend it. Hold <kbd>Shift</kbd> to snap to 45°.
- **Cover page.** Title, client, production company, date, version, a description, and an optional cover image or logo.
- **Undo and redo** for everything (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>).

**PDF export**
- Choose **1, 2, 3, 4, 6 or 8 frames per page**, page size (Letter, A4, Tabloid, A3), portrait or landscape, and whether to include the cover page, field labels, and a header with page numbers.
- A live preview shows exactly what each page will look like.
- The layout adapts to your aspect ratio and amount of text. It puts text under the images or beside them, whichever leaves the images biggest. Unusually long text is shrunk to fit.

**Saving**
- Work **autosaves in your browser** as you go.
- *File → Save project* writes a `.storyboard` file containing your images, text, framing and arrows. Use it to back up, move to another computer, or hand off to a colleague. Open it with *File → Open project* or by dropping it onto the page.

**Client review links** (optional, see the setup below)
- *Client link* uploads a copy of the storyboard and gives you a link to send. Clients open it in any browser with **no account**. They type their name once and the browser remembers it.
- Clients **click anywhere** to pin a comment: on an image, on a piece of text, on the cover or the page. They can **suggest edits** to any text, including filling in empty fields. They can **edit or delete their own comments**, and anyone can **reply**, so feedback becomes a conversation as in frame.io. Everyone with the link sees all comments, live.
- In the app, the **Feedback** panel collects everything, grouped by frame with thumbnails showing where each pin is. Suggested edits appear as a tracked change (~~removed~~ / **added**) with an **Accept edit** button that applies the text to your storyboard. You can reply as your team (with a *Team* badge), resolve and reopen threads, and copy a plain-text summary for email or Slack. Board cards show a badge with each frame's open comments.
- After making changes, click **Update link** and clients see the new version. Comments stay attached to their frames even if you reorder them.

## Getting started

### Option A: open it from your computer
1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Double-click `index.html`. It opens in your browser.

Chrome, Edge, Safari and Firefox all work. On Chrome and Edge, *Save project* lets you choose where the file goes and later saves to the same file. Other browsers download it.

### Option B: use it as a website (GitHub Pages)
This also hosts the page your clients open, so you need it for client links.

1. On GitHub, open this repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose the branch with this code (for example `main`) and the **/ (root)** folder, then **Save**.
3. After a minute or two the app is at **https://adamskov-123.github.io/Storyboard/** and the client page at **https://adamskov-123.github.io/Storyboard/review.html**.

> Storyboards autosave per browser *and* per address, so work saved while using the downloaded copy doesn't appear in the hosted copy, and vice versa. Use *File → Save project* and *Open project* to move a storyboard between them.

## Setting up client review links (one time, about 10 minutes)

Client links need somewhere online to keep the storyboard and comments. They live in **your own free Firebase project** (Google). Only you set this up; clients never need an account.

1. Go to [console.firebase.google.com](https://console.firebase.google.com/), sign in with a Google account and click **Create a project**. Any name works, and you can turn Google Analytics off. The free **Spark** plan is all you need, with no credit card.
2. In the left menu open **Databases & Storage → Firestore** and click **Add database**. (Older consoles call it **Build → Firestore Database → Create database**.)
   - Choose **Standard edition**.
   - **Database ID:** keep `(default)` if it's offered. If you type your own ID (for example `storyboards`), you'll enter the same ID in the app in step 6.
   - Pick a location near you, choose **Production mode**, and click **Create**.
3. When the database is ready, open its **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules) (the app's setup screen has a *Copy rules* button), and click **Publish**.
4. In the left menu open **Security → Authentication** (older consoles: **Build → Authentication**) and click **Get started** if you see it. On the **Sign-in method** tab, enable **Anonymous** and save.
5. Open **Project settings** (gear icon next to *Project Overview*) → **Your apps** → the **`</>`** (Web) button. Register an app with any nickname (you don't need Firebase Hosting) and copy the `firebaseConfig` code it shows.
6. In Storyboard Maker click **Client link** and paste the config. If you gave your database its own ID in step 2, type it in **Database ID** (otherwise leave that box empty). Check the **Review page address** (your GitHub Pages address from Option B, ending in `review.html`) and click **Connect**.

Then click **Create client link** and send the link to your client.

**You only do this once.** The same Firebase project holds the links for all your storyboards: for each new one, just click **Client link → Create client link**. Project files you save (*File → Save project*) carry these settings, so when you open one on another computer, in another browser, or in the hosted copy, that browser is set up automatically, and you don't paste anything again. (Your *name on replies* isn't included, since each person sets their own.)

### Good to know
- **Privacy.** Anyone with a link can view that storyboard and comment. Links contain a long random ID, and nobody can list or browse your storyboards. *Client link → More options → Stop sharing* deletes the online copy and its comments, and the link stops working.
- **Permissions** are enforced by the security rules, not just the app. Commenters can only edit or delete their own comments, and whoever started a thread can delete it. Only the browser that created a link can update it, resolve comments or post as *Team*. If you open the project file on another computer, that browser can do so too, because the file carries a secret owner key. Keep project files to yourself.
- **What gets uploaded:** each frame as you see it (framing and arrows included, about 1400 px wide), the filled-in text, and the cover page. Your original images stay on your computer.
- **Free plan limits.** Firestore's free tier stores 1 GiB and serves 50,000 document reads a day, which is plenty for typical client reviews. Each time a client opens a link, it reads about one document per frame.
- The Firebase web config isn't a secret; it's designed to be public. It's stored in your browser and in the project files you save, never in this repository.

## Keyboard shortcuts

| Where | Keys | Action |
|---|---|---|
| Anywhere | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo / redo |
| Anywhere | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd>, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>O</kbd> | Save / open project |
| Board (card focused) | <kbd>Enter</kbd>, <kbd>Delete</kbd>, <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> | Edit, delete, move frame |
| Frame editor | <kbd>Page Up</kbd>/<kbd>Page Down</kbd> | Previous / next frame |
| Frame editor | <kbd>R</kbd> / <kbd>A</kbd> | Reframe / Arrows tool |
| Frame editor | <kbd>Delete</kbd>, arrow keys | Delete or nudge the selected arrow |
| Client page | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> | Post comment or reply |

## Notes and limitations
- iPhone **HEIC** photos only open in Safari. In other browsers, export them as JPG first.
- PDFs use the built-in Helvetica font, which covers Western European languages. Other characters (for example → or emoji) are replaced with close equivalents such as `->`.
- Autosave uses your browser's storage. Clearing site data removes it, so save a project file for anything important.

## For developers

```
index.html          the editor app
review.html         the client review page
css/styles.css      styles for both pages (light and dark)
js/util.js          helpers, icons, toasts, dialogs, word diff
js/store.js         project state, undo history, IndexedDB autosave, .storyboard files
js/render.js        frame rendering: reframing and arrows (board, editor, PDF, uploads)
js/board.js         board view and drag-to-reorder
js/editor.js        frame editor (reframe, arrows, fields)
js/cover.js, js/fields.js, js/pdf.js   cover page, field manager, PDF layout and export
js/cloud.js         Firebase connection and review/comment data access
js/threads.js       comment thread UI shared by the app and the review page
js/share.js         client link setup and publishing
js/feedback.js      feedback panel in the app
js/review.js        client review page
js/rules.js         generated from firestore.rules (node tools/sync-rules.mjs)
js/vendor/          jsPDF 4.2.1 (MIT), SortableJS 1.15.7 (MIT), Firebase JS SDK 12.19.0 (Apache-2.0, bundled)
```

Scripts are classic (non-module) so the app works from `file://`. The Firebase bundle loads only when review features are used.

To test review links locally with the [Firebase emulators](https://firebase.google.com/docs/emulator-suite):

```sh
npx firebase-tools emulators:start --only firestore,auth --project demo-storyboard
python3 -m http.server 8099   # in another terminal
```

Then open `http://127.0.0.1:8099/index.html?emulator=127.0.0.1`. To make the setting stick, run `localStorage.setItem('sb-emulator', '"127.0.0.1"')` in the console. Set `sb-review-base` to `"http://127.0.0.1:8099/review.html"` so links point at the local review page. After editing `firestore.rules`, run `node tools/sync-rules.mjs`.

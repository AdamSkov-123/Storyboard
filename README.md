# Storyboard Maker

A browser app for building storyboards from your own images. Add frames, fill in the shot details, reframe each image, draw arrows, add a cover page, and export a PDF. You can also send clients a link where they comment, suggest text edits and discuss the feedback with your team.

Nothing to install and no build step. It's plain HTML, CSS and JavaScript.

## Features

**Building the storyboard**
- **Images become frames.** Click *Add images*, or drop image files anywhere on the page. Each image becomes one frame, added in filename order (`01.jpg`, `02.jpg`, … `10.jpg`). You can also paste an image from the clipboard or add a blank frame.
- **Automatic numbering.** Frames are numbered by position and renumber themselves whenever you reorder.
- **Two ways to view the board.** *Grid* shows every frame as a card (use *Card size* to make them bigger or smaller). *One at a time* shows a single large frame with its text beside it, like the client page: step through with *Previous*/*Next* or the arrow keys, or jump with the filmstrip of numbered thumbnails at the bottom. Type straight into the text beside the frame. Empty fields stay out of the way as *+ Setting*, *+ Dialogue*… buttons until you need them. Click the frame to reframe it or draw arrows. The app remembers which view you used last.
- **Reordering.** Drag cards on the board, or drag thumbnails in the filmstrip in *One at a time* view. With the keyboard, press <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> (on a focused card in the grid, or on the frame you're viewing one at a time). In the frame editor, use *Move earlier* / *Move later*.
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

**Your storyboards**
- The app opens on a **home page** listing every storyboard saved in this browser. Each shows a thumbnail, its title, client, number of frames, when it was last edited, and whether it has a client link. You can search by title or client and sort by last edited, newest or name.
- Click **New storyboard** to start one, or drop images onto the home page to start a storyboard with them. Click a card to open it, and click the logo (*‹ Storyboards*) or use the browser's Back button to return.
- Each card's **⋯** menu has *Duplicate*, *Save project file* and *Delete*. Deleting a storyboard that has a client link also turns that link off. A duplicate starts without a client link.
- Everything **autosaves in your browser** as you work. A new storyboard you leave without adding anything is discarded.
- *File → Save project* (or ⋯ → *Save project file* on the home page) writes a `.storyboard` file containing your images, text, framing and arrows. Use it to back up, move to another computer, or hand off to a colleague. *Open project file* (or dropping the file onto the page) adds it to your storyboards. If you already have that storyboard, you can replace it or keep both.

**Team storyboards** (see [the setup below](#setting-up-firebase-one-time-about-15-minutes))
- **Sign in with Google** to keep storyboards online and open them on any computer. Anyone with a Google account at your company's domain (for example @9milesmedia.com) can join just by signing in; an admin approves anyone else. Nobody outside the team can see its storyboards.
- The home page shows **Team storyboards** (shared) and **On this computer only**. Use ⋯ → *Move to team* (or *Move all to team*) to share ones you already have. While you're signed in, new storyboards are team storyboards.
- **One editor at a time.** If someone else is editing a storyboard, you can still open it **view only**: a banner says who's editing, and their changes appear live. Home page cards show who's editing. If they've walked away, you can **Take over**; anything of theirs that hadn't saved yet is kept as a copy. Editors who are idle for 20 minutes are switched to viewing, so nothing stays locked all day.
- Changes **save to the team automatically** a moment after you make them (the top bar shows *Saving…* / *Saved to team*). If your connection drops, your work stays on this computer and uploads when you're back online or next open it.
- A **storage bar** shows how much of the free plan's **1 GB** is used (by team storyboards and client links together) and roughly how many more frames fit. It turns amber at 80% and red at 95%.

**Client review links** (see the setup below)
- *Client link* uploads a copy of the storyboard and gives you a link to send. Clients open it in any browser with **no account**. They type their name once and the browser remembers it.
- Clients choose how to **view** the storyboard: **one frame at a time** (a slideshow with *Previous*/*Next*, arrow keys, and a filmstrip of numbered thumbnails showing which frames have comments) or **1, 2, 3 or 4 frames per row**. Links open one frame at a time to start with; after that, each client's choice is remembered on their device. Large frames show their text beside the image.
- Clients **click anywhere** to pin a comment: on an image, on a piece of text, on the cover or the page. They can **suggest edits** to any text, including filling in empty fields. They can **edit or delete their own comments**, and anyone can **reply**, so feedback becomes a conversation as in frame.io. Everyone with the link sees all comments, live.
- In the app, the **Feedback** panel collects everything, grouped by frame with thumbnails showing where each pin is. Suggested edits appear as a tracked change (~~removed~~ / **added**) with an **Accept edit** button that applies the text to your storyboard. You can reply as your team (with a *Team* badge), resolve and reopen threads, and copy a plain-text summary for email or Slack. Board cards show a badge with each frame's open comments.
- After making changes, click **Update link** and clients see the new version. Comments stay attached to their frames even if you reorder them.

## Getting started

### Option A: open it from your computer
1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Double-click `index.html`. It opens in your browser.

Chrome, Edge, Safari and Firefox all work. On Chrome and Edge, *Save project* lets you choose where the file goes and later saves to the same file. Other browsers download it. Google sign-in doesn't work from a file on your computer, so team storyboards and client links need Option B.

### Option B: use it as a website (GitHub Pages)
This also hosts the page your clients open, so you need it for team storyboards and client links.

1. On GitHub, open this repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose the branch with this code (for example `main`) and the **/ (root)** folder, then **Save**.
3. After a minute or two the app is at **https://adamskov-123.github.io/Storyboard/** and the client page at **https://adamskov-123.github.io/Storyboard/review.html**.

> Storyboards are saved per browser *and* per address, so storyboards made in the downloaded copy don't appear in the hosted copy, and vice versa. Use *Save project file* and *Open project file* to move one between them.

## Setting up Firebase (one time, about 15 minutes)

Team storyboards and client links are kept in **your own free Firebase project** (Google). One person sets this up. Teammates then just sign in, and clients never need an account.

1. Go to [console.firebase.google.com](https://console.firebase.google.com/), sign in with a Google account and click **Create a project**. Any name works, and you can turn Google Analytics off. The free **Spark** plan is all you need, with no credit card.
2. In the left menu open **Databases & Storage → Firestore** and click **Add database**. (Older consoles call it **Build → Firestore Database → Create database**.)
   - Choose **Standard edition**.
   - **Database ID:** keep `(default)` if it's offered. If you type your own ID (for example `storyboards`), you'll need it again in step 6.
   - Pick a location near you, choose **Production mode**, and click **Create**.
3. When the database is ready, open its **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
4. In the left menu open **Security → Authentication** (older consoles: **Build → Authentication**) and click **Get started** if you see it. Then:
   - On the **Sign-in method** tab, enable **Anonymous** and save. This lets clients comment without an account.
   - Click **Add new provider → Google**, turn it on, choose a support email and click **Save**. This is how your team signs in.
   - On the **Settings** tab, open **Authorized domains → Add domain** and add `adamskov-123.github.io`.
5. Open **Project settings** (gear icon next to *Project Overview*) → **Your apps** → the **`</>`** (Web) button. Register an app with any nickname (you don't need Firebase Hosting). It shows a `firebaseConfig` block.
6. Copy `apiKey` and `projectId` from that block into [`js/config.js`](js/config.js) in this repository. On GitHub: open the file, click the pencil icon, fill in the two values, and click **Commit changes**. If you gave your database its own ID in step 2, put it in `databaseId` too. Everyone who opens the hosted app is now connected to your project, with nothing to paste.
7. Open **https://adamskov-123.github.io/Storyboard/** (give GitHub Pages a minute to update), click **Sign in with Google**, then **Set up team**, and name the team. You're its admin. If you signed in with a work address such as `you@9milesmedia.com`, **anyone with an @9milesmedia.com Google account can join just by signing in**.
8. Send teammates the app's address. They click **Sign in with Google** with their work account, and they're in.

**People outside your domain** (freelancers, for example): click your avatar → **Team members & approvals…** and type their Google email under *Approve someone from outside…*. They sign in and they're in. You can also turn automatic joining off there, to approve everyone yourself, and set someone's role to **Admin** so they can approve people too.

**Already set up Firebase before?** Do steps 3, 4 (Google and the authorized domain), 6 and 7. The new rules keep your existing client links working.

(Prefer not to put the settings in the repository? Leave `js/config.js` empty. Each browser then gets connected by pasting the config into the setup screen, via *Connect Firebase…* on the home page, or by opening a *link for teammates* from Team members.)

### Client links
Open a storyboard, click **Client link → Create client link**, and send the link to your client. Only team members can create client links, so you need to be signed in. The same Firebase project holds the links for all your storyboards.

### Good to know
- **Who can see what.** Only team members can see or change team storyboards and create client links. This is enforced by the security rules, not just the app. When an admin removes someone, they lose access straight away, even if they're signed in at the time. People at your domain who were removed are kept on the list as *removed*, so they can't simply join again; an admin can *Restore* them.
- **Client link privacy.** Anyone with a link can view that storyboard and comment. Links contain a long random ID, and nobody can list or browse your storyboards. *Client link → More options → Stop sharing* deletes the online copy and its comments, and the link stops working.
- **Comment permissions.** Commenters can only edit or delete their own comments, and whoever started a thread can delete it. Updating a link, resolving comments and posting as *Team* need the link's secret owner key, which is stored with the storyboard (so whoever is editing a team storyboard can do these). Project files carry the key too, so keep them to yourselves.
- **What clients see:** each frame as you see it (framing and arrows included, about 1400 px wide), the filled-in text, and the cover page.
- **Signing out** removes team storyboards from that computer (they stay safe online). Storyboards that are only on that computer aren't affected.
- **Storage.** The free plan has no file storage without a credit card, so images are kept in Firestore itself. Images over about 900 KB are recompressed to fit (up to 2400 px on the long side, which is plenty for storyboards). The 1 GB is shared by team storyboards and client links; typically that's 2,000 to 4,000 frames, depending on your images. The storage bar is the app's own estimate (it doesn't count client links made from storyboards that are only on someone's computer). The **Usage** tab in Firestore has Google's exact figure. Deleting a storyboard (⋯ → *Delete for everyone*) or stopping a client link frees its space.
- **Daily limits.** The free plan allows 50,000 reads and 20,000 writes a day. Opening a team storyboard on a computer reads its text plus any images that computer hasn't downloaded before, each save writes a couple of documents, and each time a client opens a link it reads about one document per frame. A small team stays well within this.
- **The settings in `js/config.js` aren't secret.** Firebase designs them to be public, and every client link already contains them. Access is controlled by the security rules: strangers who find the app can sign in, but they only see *Waiting for approval*.
- **After updating the app**, if `firestore.rules` changed, paste it into Firestore → Rules again and click **Publish**. Admins can copy it with *Copy security rules* in Team members.

## Keyboard shortcuts

| Where | Keys | Action |
|---|---|---|
| Anywhere | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo / redo |
| Anywhere | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd>, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>O</kbd> | Save / open project |
| Board (card focused) | <kbd>Enter</kbd>, <kbd>Delete</kbd>, <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> | Edit, delete, move frame |
| One at a time view | <kbd>←</kbd>/<kbd>→</kbd>, <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> | Previous / next frame, move this frame |
| Frame editor | <kbd>Page Up</kbd>/<kbd>Page Down</kbd> | Previous / next frame |
| Frame editor | <kbd>R</kbd> / <kbd>A</kbd> | Reframe / Arrows tool |
| Frame editor | <kbd>Delete</kbd>, arrow keys | Delete or nudge the selected arrow |
| Client page | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> | Post comment or reply |
| Client page, one-at-a-time view | <kbd>←</kbd>/<kbd>→</kbd> | Previous / next frame |

## Notes and limitations
- iPhone **HEIC** photos only open in Safari. In other browsers, export them as JPG first.
- PDFs use the built-in Helvetica font, which covers Western European languages. Other characters (for example → or emoji) are replaced with close equivalents such as `->`.
- Storyboards are kept in your browser's storage. Clearing site data removes them, so save a project file for anything important. (Team storyboards are also kept online.)
- Team storyboards need an internet connection to open, and only one person can edit a storyboard at a time.

## For developers

```
index.html          the editor app
review.html         the client review page
css/styles.css      styles for both pages (light and dark)
js/util.js          helpers, icons, toasts, dialogs, word diff
js/store.js         storyboard library (IndexedDB), the open storyboard's state and undo history, .storyboard files
js/home.js          home page: all storyboards, team status, storage bar, new/duplicate/delete/import
js/team.js          team storyboards: Google sign-in, members, sync to Firestore, one-editor lock
js/config.js        your Firebase project's settings (optional; empty = set up per browser)
js/render.js        frame rendering: reframing and arrows (board, editor, PDF, uploads)
js/board.js         board view and drag-to-reorder
js/editor.js        frame editor (reframe, arrows, fields)
js/cover.js, js/fields.js, js/pdf.js   cover page, field manager, PDF layout and export
js/cloud.js         Firebase connection and review/comment data access
js/threads.js       comment thread UI shared by the app and the review page
js/share.js         Firebase setup, team link, client link publishing
js/feedback.js      feedback panel in the app
js/review.js        client review page
js/rules.js         generated from firestore.rules (node tools/sync-rules.mjs)
js/vendor/          jsPDF 4.2.1 (MIT), SortableJS 1.15.7 (MIT), Firebase JS SDK 12.19.0 (Apache-2.0, bundled)
```

Scripts are classic (non-module) so the app works from `file://`. The Firebase bundle loads only once Firebase is set up.

To test review links locally with the [Firebase emulators](https://firebase.google.com/docs/emulator-suite):

```sh
npx firebase-tools emulators:start --only firestore,auth --project demo-storyboard
python3 -m http.server 8099   # in another terminal
```

Then open `http://127.0.0.1:8099/index.html?emulator=127.0.0.1`. To make the setting stick, run `localStorage.setItem('sb-emulator', '"127.0.0.1"')` in the console. Set `sb-review-base` to `"http://127.0.0.1:8099/review.html"` so links point at the local review page. With the emulator, *Sign in* asks for an email address instead of showing Google's sign-in, so you can try several team members in separate browser profiles. In emulator mode the app ignores `js/config.js`, so local testing never touches your real Firebase project. After editing `firestore.rules`, run `node tools/sync-rules.mjs`.

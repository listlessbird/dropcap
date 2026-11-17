---
name: kindle-drop-ui
description: kindle-drop's product design and UI writing guide, covering the agreed screens and flows, the voice, the vocabulary, and the copy for buttons, statuses, errors, and empty states. Use before designing or changing any screen, flow, or user-facing string in apps/mobile, and when reviewing UI work.
---

# kindle-drop UI

Kindle Drop sends books from the user's phone to their Kindle. The interface should feel like a well-made system app: calm, quiet, and professional. Every word earns its place.

The design below was researched and agreed with the user on 2026-10-28. Build what it describes. Treat any change to a flow or to a term in the vocabulary as a product decision, and ask the user first.

## Writing rules

1. **Fewer words.** Cut every word the meaning survives without. Buttons are one to three words.
2. **Buttons are verbs that name the action.** Use "Send to Kindle", "Scan pairing code", "Cancel sending". Never "OK", "Yes", "Submit", or "Let's go".
3. **Feedback reuses the word on the button that triggered it.** "Send" leads to "Sending". "Cancel sending" leads to "Sending canceled".
4. **Sentence case for everything**, including titles, buttons, section headers, and settings.
5. **No exclamation marks, emoji, "please", "oops", "sorry", "just", "easy", or "simply".** Errors get no humor and no apology.
6. **Address the reader as "you"**, and only when a sentence needs a subject. Most labels need none.
7. **Errors say what happened and what to do next**, in two short sentences and next to the thing that failed. Never show raw codes, stack traces, or Rust error text to the user.
8. **Toggles name their on state.** Write "Confirm before sending", never "Don't skip confirmation".
9. **Plain words over clever ones.** Use no idioms and no metaphors about dropping or delivering. Say "tap", never "click".
10. **Numbers are numerals with their units:** "2.4 MB", "46%", "5.7 s". Times are relative when recent ("2 h ago", "Yesterday") and absolute after a week ("12 Oct").
11. **Single-sentence supporting text has no trailing period.** Two sentences take periods on both.

## Vocabulary

Use exactly one term per concept.

| Concept | Use | Never |
|---|---|---|
| The action | Send, Sending, Send to Kindle | Upload, Drop, Push, Deliver |
| Converting the EPUB | Converting | Processing, Building |
| Sending to the mailbox | Uploading, with a percentage | Syncing |
| In the mailbox, Kindle asleep | Waiting for Kindle | Queued, Pending |
| The Kindle took it | On Kindle | Delivered, Synced, Done |
| The Kindle's last pull | Kindle checked in 2 h ago | Last sync, Last seen |
| A failure | Couldn't convert, Couldn't upload | Failed, Error |
| First-run setup | Connect your Kindle, Pairing code | Login, Token, Worker, Mailbox URL |
| Undoing a send | Cancel sending | Delete, Remove |

"Worker", "R2", "token", "mailbox", and "EBOK" are implementation words. They never appear in the UI. The one exception is the "Enter details" fallback, which labels its fields "Server address" and "Access key".

## Screens and flows

The mockups are in [mockups.html](mockups.html). Open it in a browser.

**Library** (`kindledrop://`) is the only main screen.
- A status chip at the top shows "Kindle checked in 2 h ago" with a green dot. When the Kindle hasn't checked in for more than a day, the dot turns amber and the chip stays neutral.
- Under a "Sending" section, each row has a cover, title, author, and a status line. Converting shows an indeterminate bar. Uploading shows a determinate bar and "Uploading · 46%". Waiting shows "Waiting for Kindle".
- Under a "Recent" section, rows show "On Kindle · Yesterday" or, for failures, "Couldn't convert · Tap for details" in the danger color. Recent keeps books for 30 days, the mailbox's lifetime. A long-press clears a row.
- The empty state has the title "No books yet", the line "Share an EPUB or PDF from any app. It arrives the next time your Kindle wakes", and a "Choose a file" button.

**Share sheet.** The app opens as a bottom sheet over the app you shared from.
- It shows the cover, title, author, and "EPUB · 9.1 MB", with **Send to Kindle** as the primary action and **Cancel** as a text button.
- Conversion starts the moment the file arrives, so tapping Send feels instant. Cancel discards the conversion's output.
- After Send, the sheet closes and the source app stays in front.
- "Confirm before sending" is on by default. When it's off, sharing sends at once and shows a brief "Sending to Kindle" confirmation.

**Book** (detail).
- The cover, title, and author are centered at the top.
- A four-step timeline follows: Converted (size and time), Uploaded (time), Waiting for Kindle ("Arrives the next time your Kindle wakes"), and On Kindle.
- The one action is "Cancel sending" while the book is waiting. For a failure, show the error copy and "Try again".

**First run** (Connect your Kindle).
- The body is "Scan the pairing code from your computer. You only do this once".
- The primary action is "Scan pairing code" and the fallback is "Enter details".
- The pairing code is a QR code holding the server address and access key, printed by a command on the user's computer. Nobody types the key on a phone keyboard.

**Settings** has these sections:
- **Kindle:** Status ("Connected") and Last check-in.
- **Sending:** Confirm before sending.
- **Appearance:** Theme.
- **About:** Version.

At the bottom is "Disconnect Kindle" in the danger color, behind a confirmation dialog.

## Copy catalog

| Situation | Copy |
|---|---|
| Conversion failed | Couldn't convert this book. Try another copy of the file. |
| Unsupported file | Kindle Drop sends EPUB and PDF files. |
| Upload failed, offline | Couldn't upload. Kindle Drop retries when you're back online. |
| Upload failed, server | Couldn't upload. Try again in a few minutes. |
| Pairing code unreadable | This isn't a Kindle Drop pairing code. |
| Pairing rejected | This pairing code no longer works. Create a new one on your computer. |
| Kindle quiet for days | Kindle hasn't checked in for 3 days. Wake it to receive books. |
| Disconnect dialog | Title "Disconnect Kindle?", body "Books waiting to send stay on this phone.", actions **Disconnect** and **Cancel** |
| Cancel sending dialog | Title "Cancel sending?", body "Reaper's Gale won't reach your Kindle.", actions **Cancel sending** and **Keep** |
| Camera permission | Kindle Drop uses the camera only to scan the pairing code. Actions **Allow camera**, or **Open settings** once Android stops asking |
| Scanner hint | Point the camera at the pairing code |
| Pairing in progress | Connecting |
| Pairing offline | Couldn't connect. Check your connection and try again. |
| Pairing, server error | Couldn't connect. Try again in a few minutes. |
| Enter details, key rejected | This access key doesn't work. Check it on your computer. |
| Enter details, server unreachable | Couldn't reach this server. Check the address and try again. |
| Enter details, address invalid | Enter the full server address, such as https://example.com |
| Connection not saved | Couldn't save the connection. Try again. |
| Settings, status check failed | Couldn't check on your Kindle. Check your connection and try again. (offline) or Try again in a few minutes. (server) |
| Settings, Last check-in | "2 h ago", "Not yet" before the first check-in, "Checking" while loading, "Unknown" when it can't be fetched |
| Library chip, no check-in yet | Kindle hasn't checked in yet (amber dot) |
| Library chip, status unknown | Couldn't check on your Kindle (no dot), shown only when no earlier answer exists |
| Library row, failed | "Couldn't convert · Tap for details" or "Couldn't upload · Tap for details", in the danger color |
| Library row, canceled | Sending canceled · 2 h ago |
| Upload failed, key rejected | This pairing code no longer works. Create a new one on your computer. |
| Cancel sending failed | Couldn't cancel sending. Check your connection and try again. (offline) or Try again in a few minutes. (server) |
| Shared file unreadable | Couldn't open this file. Try sharing it again. |
| Share sheet, not connected | Title "Connect your Kindle", body "Scan the pairing code from your computer, then share the book again", actions **Connect Kindle** and **Cancel** |
| Share sheet, unsupported file | Title is the file's name, body is the unsupported file copy, action **Close** |
| Book, timeline failure | "Couldn't convert" or "Couldn't upload" under the step that failed |
| Book, canceled | "Sending canceled · 28 Oct, 10:05 am" under Waiting for Kindle |
| Book, missing | Title "Book not found", body "It may have been cleared from Recent" |

Write new copy in this voice and add it to the catalog.

## Interaction rules

- Show status where the item is. Don't send a notification for routine progress.
- Use inline status or a dialog for anything that needs action. Snackbars are only for low-priority confirmations, with at most one action.
- Use an indeterminate indicator when the duration is unknown (converting) and a determinate one when it's known (uploading). Show none for waits under a second.
- Every screen must have its empty, loading, and error states designed. Never show a blank screen.
- One primary action per screen. Destructive actions use the danger color and a confirmation that repeats the consequence.
- Build from the UI kit in `apps/mobile/src/components/ui`: ListSection, ListRow, ListToggleRow, EmptyState, ErrorBanner, Notice, Dialog, Progress, Chip, Button. Pick a `variant` or `size` rather than restyling. Colors come from theme tokens (`apps/mobile/src/lib/theme.ts`). Check both light and dark.
- No continuously repainting animations (AGENTS.md).

## Verifying UI work

Drive the change on the emulator or a device with the `test-kindle-drop-android` skill. Save screenshots of every state you touched, in light and dark. Read the copy out loud against the rules above before you report.

## Sources

The research behind these rules:
- [Android: receive data from other apps](https://developer.android.com/training/sharing/receive): let people review shared content before acting on it.
- [Android share sheet guideline](https://developer.android.com/distribute/aep/aep-req-share-sheet)
- [GitHub Primer content guidelines](https://primer.style/product/getting-started/foundations/content): sentence case, verb-first labels, banned words, and feedback that reuses the trigger's term.
- [Microsoft style guide, top 10 tips](https://learn.microsoft.com/de-de/style-guide/top-10-tips-style-voice): bigger ideas, fewer words.
- [Microsoft UI text guide](https://learn.microsoft.com/en-us/windows-server/manage/windows-admin-center/extend/guides/ui-text-style-guide): buttons of one to three words.
- [Mailchimp: writing for accessibility](https://styleguide.mailchimp.com/writing-for-accessibility/)
- [Atlassian: empty states](https://atlassian.design/content/designing-messages/empty-state) and [error messages](https://atlassian.design/foundations/content/designing-messages/error-messages)
- [Material: snackbars](https://material.io/components/snackbars)
- [Material 3 list items](https://developer.android.com/reference/kotlin/androidx/compose/material3/ListItem.composable)
- [Google Photos backup status redesign](https://9to5google.com/2025/08/05/google-photos-backup-redesign/): a status chip plus per-item state.
- [Android Central: sending files to a Kindle](https://www.androidcentral.com/apps-software/how-to-send-articles-files-or-web-pages-to-your-amazon-kindle-device) and [Push to Kindle](https://www.fivefilters.org/?p=4118): competitors' share flows and their pitfalls.
- [Smashing: empty states in onboarding](https://smashingmagazine.com/2017/02/user-onboarding-empty-states-mobile-apps)

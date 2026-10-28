# THESIS 5

**Thesis 5** is a local-first desktop text and note-taking application. It was created as an alternative to cloud services, with a focus on privacy, speed, and complete control over your data.

The app is perfect for both quick everyday notes and long-form content: **articles, guides, documentation, book drafts, and research papers**. Thanks to the block editor and flexible page hierarchy, large texts are easy to structure.

All materials are stored as standard Markdown files on your computer. No servers, no subscriptions, and no hidden syncing. You can copy your notes folder to another PC or open the files in any text editor.

## ⬇️ Download

You can download ready-to-use builds for your operating system from the [Releases](LINK_TO_YOUR_REPO_RELEASES) page.

- **Windows (Installer):** [Download Thesis 5 Setup (v1.0.1)](LINK_TO_NSIS_INSTALLER)
- **Windows (Portable):** [Download Thesis 5 Portable (v1.0.1)](LINK_TO_PORTABLE_EXE)

## ✨ Key Features

- **For Notes and Long-Form Content:** Tools to structure both short entries and long articles (table of contents, nested pages).
- **Local-first and Privacy:** Your data belongs only to you. The app works completely offline.
- **Markdown as the Source of Truth:** Every note is a `.md` file. You are not locked into the app's proprietary format.
- **Block Editor:** A powerful editor based on Tiptap with support for rich text formatting, tables, task lists, blockquotes, footnotes, and code blocks.
- **Page Hierarchy:** Create nested pages and build your knowledge base structure using drag-and-drop.
- **Instant Search:** Built-in full-text search (FTS5) powered by SQLite that works flawlessly even with thousands of notes.
- **Images:** Insert images directly from the clipboard; they are saved locally in your vault alongside the note.
- **Export and Import:** Export to Markdown, PDF, DOCX, and TXT. Import DOCX, TXT, and MD documents.
- **Customization:** 13 accent color schemes and bilingual interface support (EN/RU).

## 🛠 Tech Stack

- **Shell:** Electron
- **Frontend:** Nuxt 3 (SPA mode), Vue 3, TypeScript
- **Editor:** Tiptap 3
- **Database (Index):** SQLite (`better-sqlite3`)
- **Styling:** SCSS, CSS Variables (design system)

## 🚀 Getting Started (Development)

### Requirements
- Node.js (version 20 or higher recommended)
- npm or yarn

### Installation and Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/thesis-5.git
   cd thesis-5

2. Install dependencies:
   ```bash
   npm install
   ```

3. Rebuild the native `better-sqlite3` module for your current Electron version:
   ```bash
   npm run rebuild
   ```

4. Run the application in development mode:
   ```bash
   npm run dev
   ```

## 📦 Building the App

The project uses `electron-builder` to create release builds.

### Nuxt Preparation
Before building, you need to generate the static SPA bundle:
```bash
npm run generate
```

### Windows Installer
This will create an NSIS installer in the `release/` folder:
```bash
npm run dist
```

### Windows Portable
This will create a single `.exe` file that requires no installation:
```bash
npx electron-builder --win portable
```

### No Compression (for debugging)
```bash
npx electron-builder --win portable --config.compression=store
```

## 📂 Data Structure

By default, app data is stored in the `data/` folder next to the executable (in production) or in the project's temporary `_thesis5_temp` folder (in development).

Vault structure:
```text
vault/
  .order.json          # File containing the custom sorting order
  note-abc123/
    index.md           # Note content in Markdown
    assets/            # Attached images
      img-xxx.png
    note-def456/       # Nested subpage
      index.md
```

You can change the storage folder at any time through the app settings. The SQLite index will be automatically recreated upon switching.

## 📄 License

This project is distributed under the MIT License. See the `LICENSE` file for details.
```
0
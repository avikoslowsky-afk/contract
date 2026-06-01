# Windows Setup

This app can run on a Windows work computer or on one internal Windows server that everyone opens in a browser.

## Recommended Work Setup

Use one dedicated internal Windows computer/server:

1. Install the app there.
2. Keep the database and uploads there.
3. Turn on backups.
4. Let the team open the app from that computer's network URL.

Do not put real contracts, database files, API keys, or backups on public GitHub.

## Install Requirements

1. Install Node.js LTS from:
   https://nodejs.org

2. Install Python 3 from:
   https://www.python.org/downloads/windows/

3. Install Tesseract OCR from:
   https://github.com/UB-Mannheim/tesseract/wiki

4. Optional for free local AI:
   Install Ollama from:
   https://ollama.com

Then open Command Prompt and run:

```bat
ollama pull llama3.1
```

## Start Without AI

For testing, sign-in is off by default. Later, when you want sign-in back on, create a `.env` file from `.env.example` and change:

```text
REQUIRE_LOGIN=true
ADMIN_USER=your.admin@company.com
ADMIN_PASSWORD=use-a-long-private-password
```

Double-click:

```text
start-windows.bat
```

Then open:

```text
http://127.0.0.1:4182/
```

After signing in as the admin, open Admin -> Permissions to add people, choose their role, set facility access, reset passwords, disable users, or delete access.

## Start With Free Local AI

Double-click:

```text
start-windows-free-ai.bat
```

Then open:

```text
http://127.0.0.1:4182/
```

## Share Inside the Local Work Network

For the work team, use:

```text
start-windows-server.bat
```

That starts the app so other computers on the same network can open it.

If other computers cannot connect, right-click and run as Administrator:

```text
open-windows-firewall.bat
```

For automatic startup after restart, right-click and run as Administrator:

```text
install-windows-startup-task.bat
```

Manual command option:

```bat
set HOST=0.0.0.0
set PORT=4182
start-windows.bat
```

Then from another work computer, open:

```text
http://SERVER-IP:4182/
```

Replace `SERVER-IP` with the Windows computer's local IP address.

More detail is in `WINDOWS_SERVER_RUNBOOK.md`.

## OCR Paths

If Tesseract is not found automatically, set it before starting:

```bat
set TESSERACT_PATH=C:\Program Files\Tesseract-OCR\tesseract.exe
start-windows.bat
```

## Paid AI Option

If you later use OpenAI:

```bat
set OPENAI_API_KEY=sk-your-key-here
start-windows.bat
```

Do not save API keys into GitHub.

## GitHub Safety

The `.gitignore` file keeps private data out of GitHub:

- contract database
- uploaded contracts
- backup files
- `.env`
- keys/secrets

Use the clean zip when sharing code without private data.

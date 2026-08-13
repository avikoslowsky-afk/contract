# Show Contract Operations To Peers

The real app is running on this computer at:

```text
http://127.0.0.1:4182/
```

Peers on the same office network should open:

```text
http://192.168.251.19:4182/
```

## Before The Demo

Right-click this file and choose **Run as administrator**:

```text
peer-demo-admin-setup.bat
```

That does two things:

- Opens Windows Firewall for port `4182`
- Keeps the server computer awake during the demo

## Current Status

- Backend app: running
- OCR: ready
- Database: ready
- Free local AI: ready with Ollama `qwen2.5:3b`
- Login: off for testing

## Important

Peers must be on the same office network/VPN. This link is not meant for public internet access.

# Notion-to-GitHub Documentation Sync & Management Plan

## Overview
This document outlines the proposed workflow for using **Honoka** as a specialized management and sanitization layer to bridge official company documentation in **Notion** with technical code reviews in **GitHub**.

## 1. Problem Statement
- **Notion** is the official source of truth for design proposals, but lacks Git-integrated review tools.
- **GitHub PR Agents** (like PR-Agent) need localized, sanitized, and well-structured Markdown to provide accurate feedback.
- **Existing Batch Tools** (colleagues' solutions) lack a UI, hierarchy management, and token budget visualization.

## 2. Honoka's Role: The "Management Console"
Honoka will act as a **Virtual Staging Area** between the cloud (Notion) and the repository (GitHub).

### A. Sanitization (脫敏)
- **Local Interception**: Sensitive data (API keys, PII) is stripped or masked within `honoka-bridge` *before* hitting the disk.
- **Custom Filters**: Regex-based automatic detection and manual "Redact" view in the Honoka UI.
- **Zero-Retention Check**: Optional final safety scan using a Zero-Retention LLM provider (e.g., Azure OpenAI) to detect complex patterns without training on the data.

### B. Hierarchy Management (本地編排)
- **Virtual Folders**: Users can drag-and-drop docs in the Honoka UI to redefine hierarchy for the PR context without affecting the original Notion structure.
- **Bundling**: Grouping multiple related Notion pages into a single "Review Bundle" for a specific PR.

### C. Metadata Management (Frontmatter)
Frontmatter serves as the "Identity Card" for the AI Agent.
- `notion_url`: Reference back to the original source.
- `hierarchy_path`: Desired folder structure for GitHub.
- `sanitized`: Boolean flag indicating manual/auto check.
- `review_priority`: High/Medium/Low.
- `token_estimate`: Usage cost for AI processing.

### D. Token Budget Visualization
- Track input/output tokens used by PR Agents or preprocessing.
- Dashboard showing monthly budget remaining and cost per PR.

## 3. Proposed Workflow

```mermaid
graph TD
    A[Notion: Official Writing] -->|Browser Clipping| B(Honoka Bridge: Local)
    B -->|Sanitize / Metadata| C{Honoka UI}
    C -->|Re-organize Hierarchy| D[Staging Folder]
    C -->|Edit Frontmatter| D
    D -->|Trigger CLI| E[Existing Batch Tools]
    E -->|Push| F[GitHub PR]
    F -->|Detect| G[AI PR Agent Review]
```

## 4. Integration Strategy
Instead of reinventing the GitHub push logic, Honoka will:
1. **Prepare**: Export the cleaned and organized files to a specific directory.
2. **Handoff**: Execute the CLI commands of existing team tools (e.g., `my-batch-tool push --dir ./staging`) via `child_process`.
3. **Notify**: Provide status updates in the Honoka UI (Success/Fail/Rate-limited).

## 5. Security & Risks
- **No-Token Dependency**: By leveraging a browser-based Clipper, we avoid Notion API tokens. *Note: Current clipper is a general web clipper and requires modification to handle Notion's internal block structure.*
- **Zero Cloud Leak**: All sanitization happens on the user's **Local Machine** (Cross-platform).
- **Conflict Resolution**: Honoka tracks `last_sync_time` to warn if the Notion version is newer than the local staged version.

## 6. Local Collaboration & Consensus Protocol
To ensure fairness when the Host (Room Owner) triggers AI actions, Honoka implements a lightweight governance layer:

### A. Pseudo-Authentication & Anonymity
- **Nickname Entry**: Guests enter a name on first join (stored in local session).
- **Anonymous Mode**: Users can toggle "Incognito" for sensitive feedback.

### B. Hashing for Anonymity & Integrity
To protect user privacy while preventing "Sybil attacks" (duplicate voting), Honoka uses a client-side hashing mechanism. Even if the Chrome Extension ID is locked (identical for all users), unique identity is maintained:

```mermaid
graph TD
    subgraph Client_Side [Guest Extension]
        Seed[Generate Local_Device_Seed] --> ID[Voter_ID: SHA256(Seed + Slug)]
        ID --> SSO[Silent SSO via mDNS]
    end

    subgraph Honoka_Governance [Host Bridge / LAN]
        SSO --> Honne[Honne: Internal Discussion]
        Honne --> Vote{Consensus?}
        Vote -- No --> Honne
        Vote -- Yes --> Clerk[AI Clerk: Summarize]
    end

    subgraph Mirror_Layers [Public Sync]
        Clerk --> Notion[Notion: Tatemae]
        Clerk --> GitHub[GitHub: Final PR]
    end
```

1.  **Local Device Seed**: On first run, the extension generates a random `local_device_seed` stored in `chrome.storage.local`.
2.  **Voter ID Generation**:
    *   `Voter_ID = SHA256(local_device_seed + Article_Slug + System_Salt)`
3.  **Anonymity**: The Host sees `8f3a...` but cannot mathematically reverse it to the actual user or device.
4.  **Integrity**: Each device produces a consistent hash for a specific article, ensuring "one device, one vote".

### C. The "Honne (本音) & Tatemae (建前)" Bridge
Honoka distinguishes between internal "raw" discussion and public "consensus" content:

- **Honne (Internal)**: High-fidelity, sensitive discussions, and security reviews. These are stored in local `.honne.md` or `discussion.jsonl` files within the Leaf Bundle. They are **never** synced to Notion.
- **Tatemae (Public)**: The polished, agreed-upon documentation synced to Notion. The AI acts as a "Clerk," summarizing the Honne discussions into a professional Tatemae format once consensus is reached.

### D. Consensus Gates
- **Vote to Refactor**: AI refactoring (e.g., in Cursor) is only "unlocked" after key comments reach a consensus threshold (e.g., 50% approval).
- **Final Sign-off**: A summary of agreed changes must be digitally "initialed" by participants on the Honoka Web UI before the Host can push the final version to GitHub.

### E. Audit Trail
- **Transparency**: Every comment, vote, and sign-off is saved in a local `collaboration-log.json`.
- **Accountability**: This log can be optionally included in the GitHub PR to prove the AI's changes reflect the team's shared intent, not just the Host's preference.

## 7. Forum Architecture: The Collaborative Space

To provide a premium review experience (the "Wow" factor), Honoka utilizes a modern forum interface as the governance layer.

### A. Design Choice: Flarum vs. Custom
- **Flarum (Recommended)**: A high-performance, SPA-based forum that provides a "Social Wall" feel.
    - **Pros**: Native support for polls, mentions, and a "Discussion-first" layout.
    - **Integration**: The `honoka-bridge` pushes new clips as "Discussions" via API.
- **Local Forum (honoka-lite UI)**: A lightweight glassmorphic dashboard for quick voting and review.

### B. LAN-First & Silent SSO
- **Discovery**: Host uses `mDNS` (Bonjour) to broadcast `honoka-master.local` on the LAN.
- **Silent SSO**: Users with the Honoka Extension are automatically logged into the Forum using their `Voter_ID` hash. No manual registration is required.
- **Physical Security**: The internal discussion (Honne) is only accessible when physically connected to the Host's network, creating a natural security perimeter.

## 8. Action Items
- [ ] Implement `mDNS` discovery in `honoka-bridge/index.js`.
- [ ] Add `local_device_seed` generation to the Chrome Extension.
- [ ] Create `.honne` file handling to prevent syncing private discussions to Notion.
- [ ] Implement `POST /api/internal/vote` for anonymous LAN voting.
- [ ] Setup a Docker-based Flarum template for team "Governance Hub" deployment.
- [ ] Develop the AI "Clerk" logic to summarize `honne.jsonl` into `index.md`.


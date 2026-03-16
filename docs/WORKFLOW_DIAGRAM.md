# EcoDominicano Distributor — Workflow Diagram

## High-Level Overview

```mermaid
flowchart TB
    subgraph Trigger [Trigger]
        Timer[Daily Timer]
        Manual[Manual Run]
    end

    subgraph VM [Distributor VM]
        Lock[Acquire Lock]
        Fetch[Fetch Today Top API]
        Policy[Policy Check per Platform]
        WA[WhatsApp Multi-Group]
        Other[Telegram Reddit Facebook]
    end

    subgraph External [External Services]
        API[ecodominicano.com/api/distribution/today-top]
        Ollama[Ollama on Host PC]
        WhatsApp[WhatsApp Web]
    end

    Timer --> Lock
    Manual --> Lock
    Lock --> Fetch
    Fetch --> API
    Fetch --> Policy
    Policy --> WA
    Policy --> Other
    WA --> Ollama
    WA --> WhatsApp
```

---

## Detailed Flow: Full Run

```mermaid
flowchart TB
    Start([Start: Timer or Manual])
    AcquireLock{Lock Acquired?}
    CreateRun[Create Run Record in DB]
    FetchAPI[GET today-top API]
    APIResponse{Valid Response?}
    Article[Article: title + link]
    LoadSettings[Load settings.json]
    ForPlatform[For Each Platform in Config]

    Start --> AcquireLock
    AcquireLock -->|No| Exit1([Exit: Run in Progress])
    AcquireLock -->|Yes| CreateRun
    CreateRun --> FetchAPI
    FetchAPI --> APIResponse
    APIResponse -->|No/Empty| LogFail[Log Error, Finish Run]
    APIResponse -->|Yes| Article
    Article --> LoadSettings
    LoadSettings --> ForPlatform

    ForPlatform --> CheckEligible{Eligible?}
    CheckEligible -->|No| Skip[Skip Platform]
    CheckEligible -->|Yes| PreDelay[Random Pre-Delay]
    PreDelay --> IsWA{Platform = whatsappWeb?}
    IsWA -->|Yes| WAMultiGroup[WhatsApp Multi-Group Flow]
    IsWA -->|No| SinglePost[Single Platform Post]
    SinglePost --> RecordResult[Record Result in DB]
    WAMultiGroup --> RecordResult
    RecordResult --> MorePlatforms{More Platforms?}
    MorePlatforms -->|Yes| ForPlatform
    MorePlatforms -->|No| FinishRun[Finish Run, Release Lock]
```

---

## WhatsApp Multi-Group Flow (Detailed)

```mermaid
flowchart TB
    subgraph Scan [1. Scan Groups]
        LaunchBrowser[Launch Playwright + WhatsApp Web]
        LoadChats[Load Chat List]
        ForEachChat[For Each Chat Row]
        OpenInfo[Open Chat, Click Header]
        HasParticipants{Has Participants?}
        RecordGroup[Record Group + Member Count]
        SkipContact[Skip Contact]
    end

    subgraph Select [2. Select and Sort]
        Shuffle[Shuffle Groups Randomly]
        Pick5[Pick 5 Groups]
        SortBySize[Sort by Member Count Desc]
        Selected[Selected: Largest First]
    end

    subgraph Post [3. Post to Each Group]
        ForEachGroup[For Each of 5 Groups]
        IsLargest{Is Largest?}
        CtaPrompt[Ollama: CTA Prompt]
        NewsPrompt[Ollama: News Prompt]
        Fallback[Fallback: Plain Title + Link]
        PostWA[Post to WhatsApp]
        InterDelay[Wait 300-600s]
    end

    LaunchBrowser --> LoadChats
    LoadChats --> ForEachChat
    ForEachChat --> OpenInfo
    OpenInfo --> HasParticipants
    HasParticipants -->|Yes| RecordGroup
    HasParticipants -->|No| SkipContact
    RecordGroup --> Shuffle
    SkipContact --> ForEachChat

    Shuffle --> Pick5
    Pick5 --> SortBySize
    SortBySize --> Selected
    Selected --> ForEachGroup

    ForEachGroup --> IsLargest
    IsLargest -->|Yes + WA_OFFICIAL_CHANNEL| CtaPrompt
    IsLargest -->|No| NewsPrompt
    IsLargest -->|Yes, No Channel| NewsPrompt
    CtaPrompt --> PostWA
    NewsPrompt --> PostWA
    CtaPrompt -.->|Ollama Fails| Fallback
    NewsPrompt -.->|Ollama Fails| Fallback
    Fallback --> PostWA
    PostWA --> InterDelay
    InterDelay --> ForEachGroup
```

---

## Data Flow: Article to Message

```mermaid
flowchart LR
    subgraph Input [Input]
        API["API Response\n{title, link}"]
    end

    subgraph Article [Article Object]
        Title[title]
        URL[url/link]
        Summary[summary]
    end

    subgraph LLM [Ollama - llama3.1:8b]
        CtaPrompt["CTA Prompt\nPersuasive, follower-gen"]
        NewsPrompt["News Prompt\nHeadline + 3 bullets + link"]
    end

    subgraph Output [Output]
        CtaMsg["CTA Message\n+ [CHANNEL_LINK]"]
        NewsMsg["News Message\nDominicanized format"]
    end

    API --> Article
    Article --> CtaPrompt
    Article --> NewsPrompt
    CtaPrompt --> CtaMsg
    NewsPrompt --> NewsMsg
```

---

## Timing Diagram

```mermaid
sequenceDiagram
    participant Timer
    participant Distribute
    participant API
    participant Scanner
    participant Ollama
    participant WhatsApp

    Timer->>Distribute: Trigger
    Distribute->>API: GET today-top
    API-->>Distribute: {title, link}
    Distribute->>Scanner: scanGroups()
    Scanner->>WhatsApp: Open each chat, get participants
    Scanner-->>Distribute: [{name, memberCount}, ...]
    Distribute->>Distribute: Pick 5, sort by size

    loop For each of 5 groups
        Distribute->>Ollama: generate(prompt)
        Ollama-->>Distribute: Dominicanized message
        Distribute->>WhatsApp: post(message)
        Note over Distribute,WhatsApp: 3-5s link preview delay
        WhatsApp-->>Distribute: success/fail
        Distribute->>Distribute: Wait 300-600s
    end

    Distribute->>Distribute: Finish run
```

---

## Environment & Config Summary

| Component | Config | Purpose |
|-----------|--------|---------|
| Article source | `TODAY_TOP_URL` | API endpoint for daily article |
| Ollama | `OLLAMA_URL`, `OLLAMA_MODEL` | Host LLM for rewriting |
| WhatsApp | `WA_OFFICIAL_CHANNEL` | Channel link for CTA |
| WhatsApp | `WA_GROUP_BLOCKLIST` | Groups to exclude |
| Delays | `WA_LINK_PREVIEW_MIN/MAX` | 3-5s after pasting link |
| Delays | `WA_INTER_MESSAGE_DELAY_MIN/MAX` | 300-600s between groups |

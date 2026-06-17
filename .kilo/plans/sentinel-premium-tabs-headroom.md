# Sentinel CLI Premium: Multi-Tab with Headroom Integration

## Overview

Transform Sentinel CLI into a premium multi-tab terminal AI assistant with built-in token optimization via headroom-ai library integration. The UI will always show project context (breadcrumbs) and allow tab renaming for project tracking.

## Architecture Changes

### Phase 1: Core Multi-Session Foundation

**1.1 Refactor ContextManager**
- **File**: `src/ai/context.ts`
- **Change**: Remove singleton pattern, make it instantiable per session
- **New API**:
  ```typescript
  export class ContextManager {
    constructor(sessionId: string, options?: ContextOptions) { ... }
    // No getInstance(), use new ContextManager(id)
  }
  ```
- **Update all imports**: Replace `contextManager` with session-specific instances

**1.2 Implement SessionManager**
- **New file**: `src/core/session-manager.ts`
- **Responsibilities**:
  - Create/delete/rename sessions
  - Track active session
  - Manage session persistence (save/load from `.sentinel/sessions/`)
  - Emit session lifecycle events
- **API**:
  ```typescript
  createSession(options?: { title?: string; projectRoot?: string }): Session
  getSession(id: string): Session | undefined
  setActiveSession(id: string): void
  getActiveSession(): Session | undefined
  closeSession(id: string): void
  renameSession(id: string, title: string): void
  getAllSessions(): Session[]
  saveSession(id: string): void
  loadAllSessions(): Session[]
  ```

**1.3 Update State Management**
- **File**: `src/core/state.ts`
- **Add to AppState**:
  ```typescript
  activeSessionId: string | null;
  sessions: Session[];
  currentWorkingDir: string;
  sessionTitle: string;
  ```
- **Session Schema**:
  ```typescript
  export interface Session {
    id: string;
    title: string;
    projectRoot: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
    model: string;
    agent: string;
    cost: {
      totalTokens: number;
      estimatedCostUSD: number;
    };
    context: any; // Serialized context manager state
  }
  ```

**1.4 Session Persistence Layer**
- **New directory**: `.sentinel/sessions/`
- **Format**: One JSON file per session: `{sessionId}.json`
- **Auto-save**: Trigger on every message add, session switch, and 30-second intervals
- **File**: `src/core/session-storage.ts` - handle filesystem I/O

### Phase 2: Tab UI Implementation

**2.1 Create Header Bar Component**
- **New file**: `src/tui/header-bar.ts`
- **Layout**: 2 rows at top of screen
  - Row 1: `[● Tab 1*] | Project: /path/to/project`
  - Row 2: Breadcrumb navigation + active file
- **Features**:
  - Tab title with rename indicator (✎ on Ctrl+R)
  - Project root display
  - Breadcrumb path navigation
  - Responsive to state changes
- **Integration**:
  ```typescript
  // In app.ts
  import { createHeaderBar } from "./tui/header-bar.js";
  this.headerBar = createHeaderBar(this.screen, { ... });
  // Adjust chat.top to start after header
  this.chat.top = 2;
  ```

**2.2 Implement Tab Bar**
- **New file**: `src/tui/tab-bar.ts`
- **Use Blessed listbar widget**:
  ```typescript
  const tabBar = blessed.listbar({
    parent: screen,
    top: 0,
    height: 1,
    commands: tabs.map((tab, i) => ({
      key: `${i + 1}`,
      callback: () => switchToTab(tab.id),
    })),
    style: { /* theme colors */ }
  });
  ```
- **Features**:
  - Show all sessions as tabs
  - Visual indicator for active tab
  - Modified indicator (*) for unsaved changes
  - Keyboard shortcuts (Ctrl+1-9, Ctrl+Tab, Ctrl+Shift+Tab)
  - Clickable tabs

**2.3 Keyboard Shortcuts**
- **File**: `src/tui/app.ts` - `setupKeys()` method
- **Add bindings**:
  ```typescript
  // Tab management
  screen.key(["C-t"], () => this.createNewTab());
  screen.key(["C-w"], () => this.closeCurrentTab());
  for (let i = 1; i <= 9; i++) {
    screen.key([`C-${i}`], () => this.switchToTab(i - 1));
  }
  screen.key(["C-tab"], () => this.nextTab());
  screen.key(["C-S-tab"], () => this.previousTab());
  screen.key(["C-r"], () => this.renameTab());

  // Navigation (if no active input)
  screen.key(["C-left"], () => this.previousTab());
  screen.key(["C-right"], () => this.nextTab());
  ```

**2.4 Tab Manager Class**
- **New file**: `src/tui/tab-manager.ts`
- **Responsibilities**:
  - Manage tab UI lifecycle
  - Handle tab switching
  - Sync with SessionManager
  - Update tab bar UI
  - Focus management
- **API**:
  ```typescript
  createTab(session: Session): void
  switchTab(sessionId: string): void
  closeTab(sessionId: string): void
  renameTab(sessionId: string, title: string): void
  updateTabDisplay(sessionId: string): void
  ```

### Phase 3: Headroom Integration

**3.1 Install Headroom Library**
- **Command**: `npm install headroom-ai`
- **Add to**: `package.json`

**3.2 Create Compression Service**
- **New file**: `src/ai/compression.ts`
- **Wrap headroom-ai for sentinel usage**:
  ```typescript
  import { compress } from "headroom-ai";

  export async function compressToolOutput(
    output: string,
    toolName: string
  ): Promise<string> {
    // Use SmartCrusher for JSON, Kompress for logs, etc.
    const compressed = await compress([{
      role: "system",
      content: `[${toolName} output]\n${output}`
    }]);
    return compressed[0].content;
  }

  export async function compressMessage(
    messages: ChatMessage[]
  ): Promise<ChatMessage[]> {
    // Use CCR for conversation history
    const compressed = await compress(messages.map(m => ({
      role: m.role,
      content: m.content
    })));
    return compressed.map(c => ({ role: c.role as any, content: c.content }));
  }
  ```

**3.3 Integrate into Tool Execution**
- **File**: `src/tools/tool-executor.ts`
- **Add compression after tool execution**:
  ```typescript
  // In executeToolCall() method
  let output = await toolManager.execute(name, args);

  // Compress tool output before returning
  output = await compressToolOutput(output, name);

  return truncateOutput(output, 50000); // Then truncate
  ```

**3.4 Add Context Compression**
- **File**: `src/ai/context.ts`
- **Integrate into auto-compaction**:
  ```typescript
  async compact(): Promise<void> {
    // Keep last 6 messages
    const recent = this.messages.slice(-6);
    const older = this.messages.slice(0, -6);

    // Compress older messages instead of summarizing
    const compressedOlder = await compressMessage(older);

    this.messages = [...compressedOlder, ...recent];
  }
  ```

**3.5 Add Compression Metrics**
- **File**: `src/core/state.ts`
- **Track compression stats**:
  ```typescript
  interface CompressionStats {
    originalTokens: number;
    compressedTokens: number;
    savingsPercent: number;
    lastCompressed: number;
  }

  // Add to AppState
  compressionStats: CompressionStats;
  ```

**3.6 UI for Compression Stats**
- **File**: `src/tui/status-bar.ts`
- **Add compression indicator**:
  ```
  [READY] | [gsd] | [glm-4.6] | [87% compressed] | [$0.0123]
  ```
- **Keyboard shortcut**: `Ctrl+C` to show detailed compression stats

### Phase 4: UI Polish & Premium Features

**4.1 Breadcrumb Navigation**
- **File**: `src/tui/header-bar.ts`
- **Display current working directory structure**:
  ```
  📁 src → components → Button.tsx
  ```
- **Support**: Click to navigate, show parent directory, highlight active file

**4.2 Tab Rename UI**
- **Modal or inline edit on Ctrl+R**
- **File**: `src/tui/tab-rename-modal.ts`
- **Features**:
  - Prompt for new name
  - Validate (no empty names, no duplicate names)
  - Auto-save to session

**4.3 Tab Management Commands**
- **New file**: `src/commands/builtin/tabs.md`
- **Commands**:
  - `/tabs list` - List all tabs
  - `/tabs switch <id>` - Switch to tab
  - `/tabs close <id>` - Close tab
  - `/tabs rename <id> <name>` - Rename tab
  - `/tabs new` - Create new tab

**4.4 Project Detection**
- **File**: `src/core/project-detector.ts`
- **Detect project type from files**:
  - `package.json` → Node.js
  - `Cargo.toml` → Rust
  - `pyproject.toml` → Python
  - `pom.xml` → Java
- **Display in header bar**
- **Auto-set tab title based on project name**

**4.5 Enhanced Status Bar**
- **File**: `src/tui/status-bar.ts`
- **Show per-session cost**
- **Show compression savings**
- **Show active file (if any)
- **Show git branch (if in git repo)**

### Phase 5: Advanced Features

**5.1 Tab Search/Fuzzy Find**
- **Keyboard shortcut**: `Ctrl+P`
- **Modal to search tabs by title or project
- **Select with arrow keys, enter to switch

**5.2 Tab Pinning**
- **Pin important tabs to prevent accidental close
- **Visual indicator (📌) on pinned tabs

**5.3 Tab Export/Import**
- **Export tab to markdown or JSON
- **Import conversation from file
- **Share conversations between users

**5.4 Multi-Agent Per Tab**
- **Each tab can have different agent
- **Agent switching affects current tab only
- **Display agent in tab title

## File Structure Changes

```
src/
├── ai/
│   ├── context.ts          # Modified: remove singleton
│   └── compression.ts      # NEW: headroom integration
├── core/
│   ├── state.ts            # Modified: add session state
│   ├── session-manager.ts  # NEW: session lifecycle
│   ├── session-storage.ts  # NEW: persistence
│   └── project-detector.ts # NEW: project detection
├── tui/
│   ├── app.ts              # Modified: integrate tabs, header
│   ├── header-bar.ts       # NEW: top bar with breadcrumbs
│   ├── tab-bar.ts          # NEW: tab navigation
│   ├── tab-manager.ts      # NEW: tab UI management
│   ├── tab-rename-modal.ts # NEW: rename UI
│   └── status-bar.ts       # Modified: compression stats
├── tools/
│   └── tool-executor.ts    # Modified: add compression
└── commands/
    └── builtin/
        └── tabs.md         # NEW: tab management commands

.sentinel/
└── sessions/               # NEW: session storage
    ├── {uuid}.json
    └── ...
```

## Implementation Priority

### Week 1: Foundation
1. Install headroom-ai
2. Create SessionManager + session storage
3. Refactor ContextManager to non-singleton
4. Update state management for sessions

### Week 2: UI Core
1. Create header-bar component
2. Create tab-bar component
3. Implement TabManager
4. Add keyboard shortcuts
5. Update TUIApp to use sessions

### Week 3: Headroom Integration
1. Create compression service
2. Integrate into tool execution
3. Add context compression
4. Add compression metrics to state
5. Update status bar

### Week 4: Polish
1. Add breadcrumbs
2. Implement tab rename UI
3. Add tab management commands
4. Add project detection
5. Testing & refinement

### Week 5: Advanced Features
1. Tab search
2. Tab pinning
3. Tab export/import
4. Multi-agent per tab
5. Performance optimization

## Testing Strategy

### Unit Tests
- SessionManager CRUD operations
- Compression service with various content types
- Tab manager UI state transitions
- Session storage save/load

### Integration Tests
- Full tab lifecycle (create → switch → rename → close)
- Multi-tab concurrency
- Session persistence across restarts
- Headroom compression in real workflows

### Manual Testing Scenarios
1. Create 5 tabs, switch between them, rename 3, close 2
2. Open CLI with 10 persisted sessions, restore all
3. Run a complex agentic task with compression enabled
4. Compare token usage with/without compression
5. Test all keyboard shortcuts

## Configuration Changes

**File**: `src/core/config.ts` - add to `SentinelConfig`:

```typescript
export interface SentinelConfig {
  // ... existing fields

  // Session configuration
  sessions: {
    autoSave: boolean;
    saveInterval: number; // milliseconds
    maxSessions: number;
    restoreOnStartup: "all" | "active" | "none";
    defaultTitle: string;
  };

  // Headroom configuration
  headroom: {
    enabled: boolean;
    compressionMode: "aggressive" | "balanced" | "conservative";
    compressToolOutput: boolean;
    compressHistory: boolean;
    cacheEnabled: boolean;
  };

  // UI configuration
  ui: {
    showHeader: boolean;
    showBreadcrumbs: boolean;
    showCompressionStats: boolean;
    tabBarPosition: "top" | "bottom";
  };
}
```

## Performance Considerations

1. **Lazy Tab Loading**: Only load tab content when first accessed
2. **Debounced Auto-Save**: Save sessions 30 seconds after last change
3. **Compression Caching**: Cache compressed content to avoid recompression
4. **Virtual Scrolling**: For large chat histories in tabs
5. **Memory Limits**: Limit number of tabs (default 20) to prevent OOM

## Backward Compatibility

1. **Graceful Migration**: If old config exists, convert to new format
2. **Fallback**: If sessions directory doesn't exist, start with single session
3. **Feature Flags**: Can disable multi-tab or headroom via config
4. **CLI Flags**: `--single-session` to force old behavior

## Documentation

Create new documentation files:
- `docs/TABS.md` - Tab management guide
- `docs/HEADROOM.md` - Compression configuration
- `docs/MULTI-SESSION.md` - Session architecture
- `docs/KEYBOARD.md` - Updated keyboard shortcuts

## Success Metrics

1. **Token Savings**: 60-80% reduction in token usage with headroom
2. **Session Persistence**: 100% restore rate on restart
3. **Tab Performance**: <100ms tab switch time
4. **Compression Latency**: <500ms added to tool execution
5. **Memory Usage**: <500MB with 10 active tabs
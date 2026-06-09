---
name: browse
description: Browse web pages with headless browser
agent: code
subtask: true
---

Browse to $1 and optionally interact with the page.

Usage:
- /browse <url>
- /browse <url> click:"selector"
- /browse <url> type:"selector" "text"
- /browse <url> screenshot:"path.png"
- /browse <url> scrape

Examples:
- /browse https://example.com
- /browse https://github.com click:".header-logo"
- /browse https://google.com type:"input[name=q]" "sentinel cli" screenshot:"google.png"
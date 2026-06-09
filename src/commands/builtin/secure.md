---
name: secure
description: Security audit - find and fix vulnerabilities
agent: code
subtask: true
---

Perform a security audit on $ARGUMENTS.

Check for:
1. SQL injection
2. XSS vulnerabilities
3. CSRF issues
4. Authentication/authorization flaws
5. Sensitive data exposure (keys, tokens, passwords in code)
6. Insecure dependencies
7. Path traversal
8. Command injection
9. Insecure defaults
10. Missing input validation

For each finding:
- Severity: Critical/High/Medium/Low
- Description of the vulnerability
- Exact file and line
- Recommended fix
- Implement the fix

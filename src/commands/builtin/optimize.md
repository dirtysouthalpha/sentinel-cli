---
name: optimize
description: Analyze and optimize code for performance
agent: code
subtask: true
---

Analyze and optimize $ARGUMENTS for performance.

Steps:
1. Read the target code
2. Identify performance bottlenecks:
   - Unnecessary loops or iterations
   - Memory leaks
   - Inefficient data structures
   - Redundant computations
   - Missing memoization opportunities
   - Slow I/O patterns
3. Implement optimizations while preserving behavior
4. Add comments explaining non-obvious optimizations
5. Suggest benchmarking approach

Keep the code clean and maintainable. Only optimize what matters.

# Project Doctor 🩺

Project Doctor is a Node.js-based static code analysis tool designed to scan your project files and diagnose potential issues. It automatically analyzes your codebase across multiple vectors—including performance bottlenecks, security vulnerabilities, database queries, and general functionality errors—providing you with a clean, web-based dashboard to review the health of your code.

---

## 🚀 Features

*   **Comprehensive Code Scanning:** Automated scanning of codebases via a dedicated backend scanner.
*   **Targeted Analyzers:**
    *   🛡️ **Security Analyzer:** Identifies insecure patterns, hardcoded secrets, and common vulnerabilities.
    *   ⚡ **Performance Analyzer:** Spots synchronous bottlenecks, inefficient loops, and memory leaks.
    *   🗄️ **Database Analyzer:** Checks for raw queries, missing indexes, and unoptimized database interactions.
    *   ⚙️ **Functionality Analyzer:** Detects syntax smells, unhandled promises, and logical anti-patterns.
*   **Web Dashboard:** An intuitive, single-page frontend application (`public/index.html`) to visualize analysis results, metrics, and fixes in real-time.

---

## 📁 Repository Structure

Based on the project map, the architecture is laid out as follows:

```text
project-doctor/
├── lib/
│   ├── analyzers/
│   │   ├── database.js        # Validates database logic and query structures
│   │   ├── functionality.js   # Audits general code health and logic
│   │   ├── performance.js     # Detects lag and optimization issues
│   │   └── security.js        # Tests for security exploits/vulnerabilities
│   ├── scanner.js             # Core engine that traverses files and coordinates analyzers
│   └── util.js                # Shared helper functions across the toolkit
├── public/
│   ├── app.js                 # Frontend application script for rendering metrics
│   ├── index.html             # Main dashboard interface
│   └── style.css              # Dashboard theme and layouts
├── server.js                  # Express backend server serving the API & frontend
└── package.json               # Node.js dependencies and run scripts

---
name: file-organizer
description: Intelligently organizes your files and folders across your computer by understanding context, finding duplicates, suggesting better structures, and automating cleanup tasks. Reduces cognitive load and keeps your digital workspace tidy without manual effort.
---

# File Organizer

This skill acts as your personal organization assistant, helping you maintain a clean, logical file structure across your computer without the mental overhead of constant manual organization.

## When to Use This Skill

- Your Downloads folder is a chaotic mess
- You can't find files because they're scattered everywhere
- You have duplicate files taking up space
- Your folder structure doesn't make sense anymore
- You want to establish better organization habits
- You're starting a new project and need a good structure
- You're cleaning up before archiving old projects

## What This Skill Does

1. **Analyzes Current Structure**: Reviews your folders and files to understand what you have
2. **Finds Duplicates**: Identifies duplicate files across your system
3. **Suggests Organization**: Proposes logical folder structures based on your content
4. **Automates Cleanup**: Moves, renames, and organizes files with your approval
5. **Maintains Context**: Makes smart decisions based on file types, dates, and content
6. **Reduces Clutter**: Identifies old files you probably don't need anymore

## Instructions

When a user requests file organization help:

1. **Understand the Scope**

   Ask clarifying questions:
   - Which directory needs organization? (Downloads, Documents, entire home folder?)
   - What's the main problem? (Can't find things, duplicates, too messy, no structure?)
   - Any files or folders to avoid? (Current projects, sensitive data?)
   - How aggressively to organize? (Conservative vs. comprehensive cleanup)

2. **Analyze Current State**

   Review the target directory:
   ```bash
   # Get overview of current structure
   ls -la [target_directory]

   # Identify largest files
   du -sh [target_directory]/* | sort -rh | head -20

   # Count file types
   find [target_directory] -type f | sed 's/.*\.//' | sort | uniq -c | sort -rn
   ```

3. **Find Duplicates** (when requested)
   ```bash
   # Find exact duplicates by hash
   find [directory] -type f -exec md5 {} \; | sort | uniq -d
   ```
   **Important**: Always ask for confirmation before deleting anything.

4. **Propose Organization Plan**

   Present a clear plan before making changes:
   - Current state summary (files, folders, sizes, issues)
   - Proposed folder structure
   - Exact moves/renames/deletes you'll perform
   - Files needing the user's decision

   Ask: "Ready to proceed? (yes/no/modify)"

5. **Execute Organization**

   After approval, organize systematically with `mkdir -p` and `mv`.

   **Important Rules**:
   - Always confirm before deleting anything
   - Log all moves for potential undo
   - Handle filename conflicts gracefully
   - Stop and ask if you encounter unexpected situations

6. **Provide Summary and Maintenance Tips**
   - What changed (folders created, files organized, space freed)
   - The new structure
   - Simple maintenance habits to keep things tidy

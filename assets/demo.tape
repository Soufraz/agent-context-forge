# VHS Tape script to record pixel-perfect Bootstrapping CLI demo GIF
Output assets/demo.gif

Set FontSize 14
Set Width 1120
Set Height 700
Set Padding 20
Set Theme "TokyoNight"
Set WindowBar Colorful
Set TypingSpeed 45ms

# The recording runs under a throwaway HOME so no real username or path shows in the GIF. The
# seeded settings keep auto-compaction off, which is what triggers its prompt at the end. npm
# keeps the real cache so npx doesn't download the package inside the recording.
Hide
Type "npm_config_cache=$HOME/.npm; export npm_config_cache npm_config_yes=true"
Enter
Type "export HOME=/Users/Shared/demo PS1='demo-app ❯ ' && rm -rf $HOME && mkdir -p $HOME/.claude $HOME/demo-app && cd $HOME/demo-app"
Enter
Type `echo '{"autoCompactEnabled": false}' > $HOME/.claude/settings.json && clear`
Enter
Sleep 300ms
Show

Type "npx agent-context-forge"
Sleep 600ms
Enter

# 1. Engine selection (Claude Code default)
Sleep 2.5s
Enter

# 2. Empty directory confirm (Yes default)
Sleep 1.4s
Enter

# 3. Pillar 2: Progressive Disclosure (Text search default; LSP is opt-in)
Sleep 1.2s
Enter

# 4. Pillar 3: Observation Masking (RTK default)
Sleep 1.2s
Enter

# 5. Pillar 4: Context Isolation (Guardrail hook default)
Sleep 1.2s
Enter

# 6. Pillar 5: Episodic Memory (Auto-Memory default)
Sleep 1.2s
Enter

# 7. Layer 2: SDD Methodology (None/Decide later default)
Sleep 1.2s
Enter

# 8. Drop context prompt (No default)
Sleep 1.2s
Enter

# Wait for scaffolding & doctor output to complete
Sleep 2.8s

# 9. Auto-compaction prompt (Yes default; shown only when compaction is off on the recording machine)
Sleep 1.2s
Enter
Sleep 1.5s

# List created files using tree
Type "tree -a -I '.git'"
Sleep 400ms
Enter

# Pause to let the viewer see the generated structure
Sleep 6s

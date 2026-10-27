This fixture was generated with the project's official DeepSeek Harness
0.2.0-rc.2 Web profile and its deterministic local HTTP model on 2026-10-19.
It contains a synthetic project paused at `ask_user_question`, after analysis,
directory generation, and writing-guide validation. It has no user project data,
credentials, or remote-model requests.

`manifest.json` records the source version and SHA-256 of the ZIP and every original fixture
file. `synthetic-task.zip` keeps those business and session bytes together so release
packaging can continue excluding live data and databases everywhere else. The compressed official sessions are copied byte for byte. Lock files and
the generated skills-directory symlink are omitted. The upgrade test copies
these files into its temporary application and temporary DSH home, verifies that
the old native event prefix survives, answers the original question, and finishes
the existing workflow in its original main session.

Because the synthetic session was created in a different temporary directory,
the test sets its working directory through the official `workingDirectory.set`
API before answering. This appends a normal directory-change event; it does not
rewrite the old session bytes or add any production data migration.

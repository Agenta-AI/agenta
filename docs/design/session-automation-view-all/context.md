# User Problem

The agent Overview page shows Sessions and Automation runs as separate cards. Before this change,
both View all links used the same agent sessions URL. A user who selected Automation runs could
therefore arrive at the default conversation list instead of the automation-run list.

The sessions page already has an Automation runs control. The missing behavior was a durable way
for the Overview link to request that existing mode.

This change does not alter session APIs, the meaning of trigger-origin sessions, or the filters
available after the page loads. It only carries the selected card's mode through navigation.

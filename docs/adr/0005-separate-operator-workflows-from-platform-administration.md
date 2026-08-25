# Separate operator workflows from platform administration

TorobRent puts routine, capability-gated Operator workflows in a dedicated React workspace while
retaining user and permission provisioning, technical configuration, and break-glass data repair
in Django admin. Operators use ordinary verified accounts and receive only the capabilities needed
for their responsibilities; Django `is_staff` remains a separate grant for entering Django admin.
This preserves a task-focused operational interface without rebuilding Django's general-purpose
administration and security controls in React.

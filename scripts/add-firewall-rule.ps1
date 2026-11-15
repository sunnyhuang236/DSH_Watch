New-NetFirewallRule -DisplayName 'DSH Watch M3 8787' -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private,Public

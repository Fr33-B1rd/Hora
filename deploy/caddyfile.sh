#!/usr/bin/env bash
# Print the HTTPS proxy's configuration: the owner's site and, once deploy/demo-on.sh
# has set a judge password, the demo site next to it. Used by setup-vm.sh and demo-on.sh,
# so that re-running either keeps both sites.
#   bash deploy/caddyfile.sh 34-51-186-249.sslip.io | sudo tee /etc/caddy/Caddyfile
set -euo pipefail
host="${1:?usage: bash deploy/caddyfile.sh <public-hostname>}"
site() {  # hostname, user, password hash, local port
  cat <<EOF
$1 {
	encode gzip
	basicauth {
		$2 $3
	}
	reverse_proxy 127.0.0.1:$4 {
		flush_interval -1
	}
}
EOF
}
site "$host" daylight "$(cat "$HOME/.daylight-proxy-hash")" 4318
if [ -s "$HOME/.daylight-demo-hash" ]; then
  echo
  site "demo.$host" judge "$(cat "$HOME/.daylight-demo-hash")" 4319
fi

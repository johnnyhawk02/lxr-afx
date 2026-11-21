#!/usr/bin/env bash
# Adds up GitHub download counts for every Dipogon release, per platform.
#   tools/downloads.sh            (needs the gh CLI, signed in)
# Each CI build is its own numbered release (build-N) and is kept, so these totals grow over time. Builds before
# numbered releases (the old re-created plugin-latest) lost their counts. install.sh = Mac curl installs (each one
# also fetches the three Mac zips, so Mac zip counts include them). Counts include CI and test downloads.
set -euo pipefail
REPO="${1:-johnnyhawk02/lxr-afx}"
gh api "repos/$REPO/releases" --paginate --jq '.[] | .tag_name as $t | .assets[] | [$t, .name, .download_count] | @tsv' |
awk -F'\t' '
  { n=$2; c=$3
    p = (n=="install.sh") ? "Mac curl (install.sh)" : (n ~ /windows/) ? "Windows" : (n ~ /linux/) ? "Linux" : "Mac"
    plat[p]+=c; file[n]+=c; rel[$1]+=c; total+=c }
  END {
    print "By platform:"; for (p in plat) printf "  %-24s %6d\n", p, plat[p]
    print "By file:";     for (f in file) printf "  %-24s %6d\n", f, file[f]
    print "By release:";  for (r in rel)  printf "  %-24s %6d\n", r, rel[r]
    printf "Total downloads:           %6d\n", total }'

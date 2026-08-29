#!/bin/bash
OUTPUT_FILE="cluster_node_status.txt"

echo "==========================================" > "$OUTPUT_FILE"
echo "  HPC NODE STATUS REPORT - $(date)" >> "$OUTPUT_FILE"
echo "==========================================" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

run_cmd() {
    echo "------------------------------------------" >> "$OUTPUT_FILE"
    echo "$ $1" >> "$OUTPUT_FILE"
    echo "------------------------------------------" >> "$OUTPUT_FILE"
    eval "$1" >> "$OUTPUT_FILE" 2>&1
    echo "" >> "$OUTPUT_FILE"
}

# Slurm commands
if command -v sinfo &> /dev/null; then
    run_cmd "sinfo"
    run_cmd "sinfo -N -l"
    run_cmd "sinfo -s"
    run_cmd "sinfo --format='%10P %5a %10l %16F %10G'"
    run_cmd "scontrol show nodes"
fi

# PBS commands
if command -v pbsnodes &> /dev/null; then
    run_cmd "pbsnodes -a"
    run_cmd "pbsnodes -l"
fi

# LSF commands
if command -v bhosts &> /dev/null; then
    run_cmd "bhosts"
    run_cmd "lshosts"
    run_cmd "lsload"
fi

echo "Results saved to $OUTPUT_FILE"

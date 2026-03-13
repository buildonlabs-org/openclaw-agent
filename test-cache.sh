#!/bin/bash
# Test script to check what's in the skill cache

echo "=== Checking skill cache directory ==="
echo "Looking for: /opt/skills-cache/skills"
echo ""

if [ -d "/opt/skills-cache/skills" ]; then
  echo "✓ Cache directory exists"
  echo "Contents:"
  ls -la /opt/skills-cache/skills
  echo ""
  echo "Size:"
  du -sh /opt/skills-cache/skills
else
  echo "✗ Cache directory not found"
  echo ""
  echo "Searching for any skills-cache directories:"
  find /opt -name "*skills*" 2>/dev/null || echo "No matches"
  echo ""
  echo "Checking /opt contents:"
  ls -la /opt/ 2>/dev/null || echo "/opt does not exist"
fi

echo ""
echo "=== Checking ClawHub CLI ==="
which clawhub || echo "clawhub not in PATH"
clawhub --version 2>&1 || echo "clawhub command failed"

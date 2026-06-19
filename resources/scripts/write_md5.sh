#!/bin/sh

for f in *.exe; do
    cp "$f" "$f.backup"
    touch -t 200001010000 "$f.backup"
done

for f in *.dll; do
    cp "$f" "$f.backup"
    touch -t 200001010000 "$f.backup"
done

echo ok!

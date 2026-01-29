# Xtract

Bash script to extract common file formats

> I made this cause i dont remmember tar commands, they dont make sense to me and i dont want to go to archwiki or reddit or do a google search to find out right commands.

anyways here is how you can use it

```bash
xtrat [OPTIONS] <file>
```

### supported OPTIONS

    -h, --help      Show this help message
    -l, --list      List contents without extracting
    -v, --verbose   Show extraction progress
    -d, --dir DIR   Extract to specified directory

### Suported Formats

    .tar.bz2, .tbz2    bzip2 compressed tar
    .tar.gz, .tgz      gzip compressed tar
    .tar.xz            xz compressed tar
    .tar.zst           zstd compressed tar
    .tar               uncompressed tar
    .bz2               bzip2 compressed
    .gz                gzip compressed
    .xz                xz compressed
    .zst               zstd compressed
    .zip               zip archive
    .rar               rar archive
    .7z                7z archive
    .Z                 compress format

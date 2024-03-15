# Change Log

All notable changes to the "dbos-ttdbg" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).
This project adheres to [Semantic Versioning](https://semver.org) and uses 
[NerdBank.GitVersioning](https://github.com/AArnott/Nerdbank.GitVersioning) to manage version numbers.

As per [VSCode recommendation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions),
this project uses *EVEN* minor version numbers for release versions and *ODD* minor version numbers for pre-release versions,

## [0.9] 2024-02-28

- Initial preview release

## Unreleased

### Changed

- DBOS Cloud integration now uses Cloud API directly instead of `dbos-cloud` CLI.
- `Delete Stored Application Database Passwords` command renamed to `Delete Stored Passwords`
- `Delete Stored Passwords` command deletes stored DBOS Cloud credentials as well as cloud hosted database passwords.
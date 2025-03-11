# Change Log

All notable changes to the "dbos-ttdbg" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).
This project adheres to [Semantic Versioning](https://semver.org) and uses 
[NerdBank.GitVersioning](https://github.com/AArnott/Nerdbank.GitVersioning) to manage version numbers.

As per [VSCode recommendation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions),
this project uses *EVEN* minor version numbers for release versions and *ODD* minor version numbers for pre-release versions,

## [2.0] 2025-03-11

### Added

* Added Replay debugging (local and cloud)
* Added DBOS Transact Python support (Requires v0.23 or later)
* Added support for Typescript "V2" API
* Added `Browse DBOS Cloud App` command to navigate to a selected DBOS cloud application
* Added `debug_proxy_prerelease` configuration setting, to support automatically installing prerelease versions of the Time Travel Debug Proxy
* added `just_my_code` configuration setting, to control [`justMyCode`](https://code.visualstudio.com/docs/python/debugging#_justmycode) Python debugger setting
* Added `time_travel_code_lens_enabled` configuration setting

### Changed

* Time Travel Debug Code Lens now only attached to DBOS Workflow methods

### Removed

* Removed Dashboard URI Handler
* Removed `Refresh DBOS Cloud Resources`, `Shutdown Debug Proxy`, `Launch DBOS Dashboard`, and `Set Application Name` commands
* Removed `dbos-ttdbg.get-proxy-url` and `dbos-ttdbg.pick-workflow-id` command variables
* Removed `debug_pre_launch_task`, `debug_proxy_launch`, `prov_db_host/port/database/user` configuration settings



## [1.4] 2024-08-20

### Added

- Custom app name support ([#35](https://github.com/dbos-inc/ttdbg-extension/pull/35))
- `debug_proxy_path` and `debug_proxy_launch` settings ([#40](https://github.com/dbos-inc/ttdbg-extension/pull/40))
- Use Debug Proxy Role for connection to provenance DB ([#41](https://github.com/dbos-inc/ttdbg-extension/pull/41))


### Fixed

- Update URL protocol to use ipv4 ([#36](https://github.com/dbos-inc/ttdbg-extension/pull/36))
- Look for launch config using dbos or dbos-sdk ([#37](https://github.com/dbos-inc/ttdbg-extension/pull/37))

### Removed

- removed `Delete Stored Application Database Password` and `Delete Stored Passwords` commands (obsoleted by [#41](https://github.com/dbos-inc/ttdbg-extension/pull/41))



## [1.2] 2024-05-06

### Added

- Added DBOS Cloud views of cloud applications and database instances.
- Added `Launch Debug Proxy` and `Launch DBOS Dashboard` commands and menu items.
- Added `Delete Stored DBOS Cloud Credentials` and `Delete Stored Application Database Password` commands.

### Changed 

- Modified 

### Engineering

- Added custom `prep-release.mjs` script that implements `nbgv prepare-release` but using this project's
  [version numbering strategy](https://github.com/dbos-inc/ttdbg-extension?tab=readme-ov-file#versioning-strategy).

## [1.0.9] 2024-03-19

### Fixed

- Fixed Workflow Picker always returning first item. ([#29](https://github.com/dbos-inc/ttdbg-extension/issues/29))

### Engineering

- Updated `softprops/action-gh-release` action to v2.0.2 and fixed commit tagged for the release.

## [1.0.5] 2024-03-18

### Changed

- DBOS Cloud integration now uses Cloud API directly instead of invoking the `dbos-cloud` CLI.
- `Delete Stored Application Database Passwords` command renamed to `Delete Stored Passwords`
- `Delete Stored Passwords` command deletes stored DBOS Cloud credentials as well as cloud hosted app database passwords.
- Simplified launching the DBOS Cloud Dashboard to silently call `createDashboard` if `getDashboard` returns undefined. 
  Previously, undefined `getDashboard` would launch the `createDashboard` url but cancel launching the debugger.

## [1.0] 2024-03-12

- Initial release

## [0.9] 2024-02-28

- Initial preview release

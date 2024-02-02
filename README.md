# dbos-ttdbg README

## Versioning Strategy

The DBOS Time Travel Debugger extension uses the following
[VSCode recommendation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions)
for handling version numbers:

> We recommend that extensions use `major.EVEN_NUMBER.patch` for release versions and 
> `major.ODD_NUMBER.patch` for pre-release versions. 
> For example: `0.2.*` for release and `0.3.*` for pre-release.

The `main` branch of this repo tracks release quality work. 
As such, the `main` branch will always have an even minor version number.
Pre-release quality work (when happening) will be tracked in the `dev` branch.
The `dev` branch minor version number will always be odd and one greater than the current `main` branch minor version number.

Release versions of the extension are published out of release branches.
Pre-release versions are published directly out of the `dev` branch. 

Release branches are always created from the main branch.
Usually, `main` and `dev` branches both have their minor version incremented by two when a release branch is created

> Note, this project uses NerdBank Git Versioning to manage release version numbers.
> As such, patch versions of public releases will typically not be sequential. 

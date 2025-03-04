# Development Notes

## Working with ANTLR 

This extension uses a parser generated by [ANTLR](https://www.antlr.org/) for parsing DBOS Transact-Python code.
The Python grammar and generated parser files are in the `src/parsers/python` directory of the repo.

### Install ANTLR Tools

Assuming Python 3 is installed, [antlr4-tools](https://github.com/antlr/antlr4-tools) is the easiest way to setup ANTLR on a developer machine.
Simply use `pip` or `pipx` to install the antlr4-tools package locally. 
antlr4-tools will take care of downloading the ANTLR4 JAR file as well as a portable Java Runtime Environment if one is needed.

``` shell
$ pipx install antlr4-tools
```

> Note, the author uses `pipx` instead of `pip` to install `antlr4-tools`. 

### Generating the Python Parser

This extension package includes an NPM script to generate the Python lexer, parser and listener files.
Since the grammar files that these are generated from changes infrequently, the generated code is committed to the repo.
This allows developers working on the extension to build and run it without needing to setup antlr4-tools.

``` shell
$ npm run generate
```

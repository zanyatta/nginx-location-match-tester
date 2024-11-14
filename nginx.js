var Nginx;
(function (Nginx) {
    "use strict";
    var State;
    (function (State) {
        State[State["SKIP"] = 0] = "SKIP";
        State[State["IN_STRING"] = 1] = "IN_STRING";
        State[State["QUOTED"] = 2] = "QUOTED";
        State[State["TOKEN"] = 3] = "TOKEN";
        State[State["COMMENT"] = 4] = "COMMENT";
        State[State["STATEMENT_END"] = 5] = "STATEMENT_END";
        State[State["BEGIN_BLOCK"] = 6] = "BEGIN_BLOCK";
    })(State || (State = {}));
    var Token;
    (function (Token) {
        Token[Token["END_OF_STATEMENT"] = 0] = "END_OF_STATEMENT";
        Token[Token["BEGIN_BLOCK"] = 1] = "BEGIN_BLOCK";
        Token[Token["END_BLOCK"] = 2] = "END_BLOCK";
        Token[Token["END_DOCUMENT"] = 3] = "END_DOCUMENT";
    })(Token || (Token = {}));
    class Lexer {
        constructor(config) {
            this.config = config;
            this.position = 0;
            this.state = State.SKIP;
            this.lineno = 1;
        }
        next_char() {
            if (this.position >= this.config.length) {
                return null;
            }
            let c = this.config[this.position];
            this.position += 1;
            return c;
        }
        next_token() {
            // leftover tokens
            switch (this.state) {
                case State.STATEMENT_END:
                    this.state = State.SKIP;
                    return [this.lineno, Token.END_OF_STATEMENT];
                case State.BEGIN_BLOCK:
                    this.state = State.SKIP;
                    return [this.lineno, Token.BEGIN_BLOCK];
            }
            while (true) {
                let c = this.next_char();
                if (c == "\n")
                    this.lineno += 1;
                if (c == null) {
                    return [this.lineno, Token.END_DOCUMENT];
                }
                switch (this.state) {
                    case State.SKIP:
                        switch (c) {
                            // whitespace
                            case ' ':
                            case "\t":
                            case "\n":
                                break;
                            case ';':
                                return [this.lineno, Token.END_OF_STATEMENT];
                            case '{':
                                return [this.lineno, Token.BEGIN_BLOCK];
                            case '}':
                                return [this.lineno, Token.END_BLOCK];
                            case '#':
                                this.state = State.COMMENT;
                                break;
                            case '"':
                                this.state = State.IN_STRING;
                                this.buffer = "";
                                break;
                            default:
                                this.buffer = c;
                                this.state = State.TOKEN;
                                break;
                        }
                        break;
                    case State.COMMENT:
                        // eat it until the end of the line
                        switch (c) {
                            case "\n":
                                this.state = State.SKIP;
                                break;
                            default:
                                break;
                        }
                        break;
                    case State.TOKEN:
                        switch (c) {
                            case ' ':
                            case "\t":
                            case "\n":
                                this.state = State.SKIP;
                                return [this.lineno, this.buffer];
                            case ';':
                                this.state = State.STATEMENT_END;
                                return [this.lineno, this.buffer];
                            case '{':
                                this.state = State.BEGIN_BLOCK;
                                return [this.lineno, this.buffer];
                            case '#':
                                this.state = State.COMMENT;
                                return [this.lineno, this.buffer];
                            default:
                                this.buffer += c;
                                break;
                        }
                        break;
                    case State.IN_STRING:
                        switch (c) {
                            case "\\":
                                this.state = State.QUOTED;
                                break;
                            case '"':
                                this.state = State.SKIP;
                                return [this.lineno, this.buffer];
                            default:
                                this.buffer += c;
                                break;
                        }
                        break;
                    case State.QUOTED:
                        switch (c) {
                            case 'n':
                                this.buffer += "\n";
                                break;
                            default:
                                this.buffer += c;
                                break;
                        }
                        this.state = State.QUOTED;
                        break;
                }
            }
        }
    }
    class Parser {
        constructor(lexer, warnings) {
            this.lexer = lexer;
            this.warnings = warnings;
            this.config = [];
            this.statement = [];
            this.statement_lineno = null;
        }
        parse() {
            let st_line = null;
            while (true) {
                let lineno_token = this.lexer.next_token();
                let tok = lineno_token[1];
                switch (tok) {
                    case Token.END_DOCUMENT:
                        return this.config;
                    case Token.BEGIN_BLOCK:
                        st_line = this.statement_lineno;
                        this.statement_lineno = null;
                        let block_parser = new Parser(this.lexer, this.warnings);
                        this.statement.push(block_parser.parse());
                        this.config.push(this.statement);
                        this.statement = [];
                        break;
                    case Token.END_BLOCK:
                        if (this.statement.length > 0) {
                            this.config.push(this.statement);
                            this.statement = [];
                        }
                        return this.config;
                    case Token.END_OF_STATEMENT:
                        st_line = this.statement_lineno;
                        this.statement_lineno = null;
                        if (this.statement.length == 0)
                            break;
                        if (this.statement[0] == 'include') {
                            this.warnings.push(`line ${st_line}: no files available, didn't include ${this.statement[1]}`);
                            this.statement = [];
                            break;
                        }
                        this.config.push(this.statement);
                        this.statement = [];
                        break;
                    default:
                        if (!this.statement_lineno) {
                            this.statement_lineno = lineno_token[0];
                        }
                        this.statement.push(tok);
                        break;
                }
            }
        }
    }
    var Match;
    (function (Match) {
        Match[Match["Regex"] = 0] = "Regex";
        Match[Match["RegexNoCase"] = 1] = "RegexNoCase";
        Match[Match["Prefix"] = 2] = "Prefix";
        Match[Match["PrefixPriority"] = 3] = "PrefixPriority";
        Match[Match["Exact"] = 4] = "Exact";
    })(Match || (Match = {}));
    class Location {
        constructor(path, match, contents) {
            this.path = path;
            this.match = match;
            this.contents = contents;
        }
    }
    class Server {
        constructor(config, order) {
            this.order = order;
            this.index = [];
            this.locations = [];
            this.server_name = [];
            for (let s of config) {
                switch (s[0]) {
                    case 'root':
                        this.root = s[1];
                        break;
                    case 'server_name':
                        for (let i in s) {
                            if (i == 0)
                                continue;
                            this.server_name.push(s[i]);
                        }
                        break;
                    case 'index':
                        for (let i in s) {
                            if (i == 0)
                                continue;
                            this.index.push(s[i]);
                        }
                        break;
                    case 'location':
                        switch (s[1]) {
                            case '=':
                                this.locations.push(new Location(s[2], Match.Exact, s[3]));
                                break;
                            case '~':
                                this.locations.push(new Location(s[2], Match.Regex, s[3]));
                                break;
                            case '~*':
                                this.locations.push(new Location(s[2], Match.RegexNoCase, s[3]));
                                break;
                            case '^~':
                                this.locations.push(new Location(s[2], Match.PrefixPriority, s[3]));
                                break;
                            default:
                                this.locations.push(new Location(s[1], Match.Prefix, s[2]));
                                break;
                        }
                        break;
                    default:
                        // ignore unknown lines
                        break;
                }
            }
        }
        toString() {
            return `[Server name: ${this.server_name} root: ${this.root} locations: ${this.locations.length}]`;
        }
        serverMatch(url) {
            function suffix_match(hostname, given) {
                if (hostname[0] != '*')
                    return false;
                return given.endsWith(hostname.substr(1));
            }
            function prefix_match(hostname, given) {
                if (hostname[hostname.length - 1] != '*')
                    return false;
                return given.startsWith(hostname.substr(0, hostname.length - 2));
            }
            let matches = [];
            for (let name of this.server_name) {
                if (!name.startsWith('~')) {
                    if (url.hostname == name) {
                        matches.push([4]);
                    }
                    else if (suffix_match(name, url.hostname)) {
                        matches.push([3, name.length]);
                    }
                    else if (prefix_match(name, url.hostname)) {
                        matches.push([2, name.length]);
                    }
                }
                else {
                    let re = new RegExp(name.substr(1));
                    if (url.hostname.match(re)) {
                        matches.push([1, this.order]);
                    }
                }
            }
            return matches;
        }
        locationMatch(url) {
            // collect valid matches in order of checking, chosen or not
            let results = [];
            // check for exact matches
            for (let loc of this.locations) {
                if (loc.match != Match.Exact)
                    continue;
                if (loc.path == url.pathname) {
                    results.push(loc);
                    return [loc, results];
                }
            }
            // check prefixes
            let best_match = null;
            let best_length = 0;
            for (let loc of this.locations) {
                if (loc.match != Match.Prefix && loc.match != Match.PrefixPriority)
                    continue;
                if (url.pathname.startsWith(loc.path)) {
                    results.push(loc);
                    if (loc.path.length > best_length) {
                        best_match = loc;
                        best_length = loc.path.length;
                    }
                }
            }
            // for priority prefix match, don't go on to regex matching
            if (best_match && best_match.match == Match.PrefixPriority) {
                return [best_match, results];
            }
            // regex match
            for (let loc of this.locations) {
                if (loc.match == Match.Regex || loc.match == Match.RegexNoCase) {
                    let options = "";
                    if (loc.match == Match.RegexNoCase)
                        options = "i";
                    let re = new RegExp(loc.path, options);
                    if (url.pathname.search(re) > -1) {
                        results.push(loc);
                        return [loc, results];
                    }
                }
            }
            // regex failed, use the stored longest match
            if (best_match) {
                return [best_match, results];
            }
            // no previous match
            return [null, results];
        }
        get serverNames() {
            return this.server_name;
        }
    }
    class CheckResult {
        constructor(server, server_score, location, location_type, checked_matching) {
            this.server = server;
            this.server_score = server_score;
            this.location = location;
            this.location_type = location_type;
            this.checked_matching = checked_matching;
        }
    }
    class Config {
        constructor(config) {
            this.config = config;
            this.got_servers = false;
            this.servers = [];
            // find http block if available
            for (let b of config) {
                if (b[0] == 'http') {
                    config = b[1];
                    break;
                }
            }
            let server_order = 1000;
            // are servers there?
            for (let b of config) {
                if (b[0] == 'server') {
                    this.servers.push(new Server(b[1], server_order));
                    this.got_servers = true;
                    server_order -= 1;
                }
            }
            if (!this.got_servers) {
                // whole block is a server, just include it that way
                this.servers.push(new Server(this.config, 1));
            }
        }
        toString() {
            let res = "[";
            for (let s of this.servers) {
                res += s.toString();
                res += ', ';
            }
            res += "]";
            return res;
        }
        checkUrl(url) {
            let target = new URL(url);
            let best_server = null;
            let best_score = [0];
            if (this.got_servers) {
                for (let server of this.servers) {
                    let scores = server.serverMatch(target);
                    for (let score of scores) {
                        if (best_score[0] < score[0]) {
                            best_score = score;
                            best_server = server;
                            continue;
                        }
                        if (best_score[0] == score[0] && score.length > 1 && best_score[1] < score[1]) {
                            best_score = score;
                            best_server = server;
                            continue;
                        }
                    }
                }
                if (best_server) {
                    console.log(`Selected server ${best_server.toString()} with score ${best_score}`);
                }
                else {
                    return new CheckResult(null, null, null, null, []);
                }
            }
            else {
                best_server = this.servers[0];
                console.log("Only one server defined");
            }
            let res = best_server.locationMatch(target);
            let loc_string = res[0] && res[0].path;
            let loc_type = res[0] && res[0].match;
            let all_matches = res[1];
            console.log(`Selected location ${loc_string}`);
            return new CheckResult(best_server, best_score, loc_string, loc_type, all_matches);
        }
    }
    function matchTypeToString(match) {
        switch (match) {
            case Match.Exact: return "exact";
            case Match.Regex: return "case sensitive regex";
            case Match.RegexNoCase: return "case insensitive regex";
            case Match.Prefix: return "prefix";
            case Match.PrefixPriority: return "priority prefix";
        }
    }
    function createHeader(text) {
        let header = document.createElement('div');
        header.classList.add("panel-heading");
        let title = document.createElement('h3');
        title.classList.add("panel-title");
        title.appendChild(document.createTextNode(text));
        header.appendChild(title);
        return header;
    }
    function resultContainer(text, cls) {
        let container = document.createElement('div');
        container.classList.add("panel-" + cls);
        container.classList.add("panel");
        container.appendChild(createHeader(text));
        let contents = document.createElement('div');
        contents.classList.add("panel-body");
        container.appendChild(contents);
        return [container, contents];
    }
    function resultsAsList(result) {
        let [container, contents] = resultContainer("Locations tried", 'info');
        let list = document.createElement('ol');
        for (let loc of result.checked_matching) {
            let entry = document.createElement('li');
            let description = document.createTextNode(`${matchTypeToString(loc.match)} match for location: ${loc.path}`);
            entry.appendChild(description);
            list.appendChild(entry);
        }
        contents.appendChild(list);
        return container;
    }
    function removeChildren(node) {
        while (node.lastChild) {
            node.removeChild(node.lastChild);
        }
    }
    function configDescription(config) {
        let [container, contents] = resultContainer("Config", 'info');
        let servers = document.createElement('p');
        if (config.got_servers) {
            servers.appendChild(document.createTextNode(`Found ${config.servers.length} server(s) defined. Attempted server name matching.`));
        }
        else {
            servers.appendChild(document.createTextNode("No server blocks found. Will match only on path component."));
        }
        contents.appendChild(servers);
        if (config.got_servers) {
            let list = document.createElement('ol');
            for (let server of config.servers) {
                let entry = document.createElement('li');
                let description = document.createTextNode(server.server_name.toString());
                entry.appendChild(description);
                list.appendChild(entry);
            }
            contents.appendChild(list);
        }
        return container;
    }
    function serverMatch(result) {
        let [container, contents] = resultContainer("Server match", 'info');
        let server = document.createElement('p');
        if (result.server) {
            server.appendChild(document.createTextNode(`Matched server with names: ${result.server.serverNames}.`));
        }
        else {
            server.appendChild(document.createTextNode(`Did not match any server.`));
        }
        contents.appendChild(server);
        return container;
    }
    function parseWarnings(parser) {
        let [container, contents] = resultContainer("Config processing warnings", 'danger');
        let list = document.createElement('ul');
        for (let warning of parser.warnings) {
            let entry = document.createElement('li');
            let description = document.createTextNode(warning);
            entry.appendChild(description);
            list.appendChild(entry);
        }
        contents.appendChild(list);
        return container;
    }
    function matchDescription(result) {
        let [container, contents] = resultContainer("Final match", 'success');
        let location = document.createElement('p');
        location.appendChild(document.createTextNode(`Location: ${result.location}`));
        contents.appendChild(location);
        let match = document.createElement('p');
        match.appendChild(document.createTextNode(`Match type: ${matchTypeToString(result.location_type)}`));
        contents.appendChild(match);
        return container;
    }
    function errorDescription(text) {
        let [container, contents] = resultContainer("Errors", 'danger');
        let error = document.createElement('p');
        error.appendChild(document.createTextNode(text));
        contents.appendChild(error);
        return container;
    }
    function runCheck(src, dest, url) {
        let p = new Parser(new Lexer(src), []);
        let config = new Config(p.parse());
        try {
            let res = config.checkUrl(url);
            removeChildren(dest);
            dest.appendChild(configDescription(config));
            if (p.warnings.length > 0) {
                dest.appendChild(parseWarnings(p));
            }
            if (config.got_servers) {
                dest.appendChild(serverMatch(res));
            }
            if (res.location) {
                dest.appendChild(resultsAsList(res));
                dest.appendChild(matchDescription(res));
            }
            else {
                dest.appendChild(errorDescription("No locations matched"));
            }
        }
        catch (e) {
            removeChildren(dest);
            if (e.message.search("URL") != -1) {
                dest.appendChild(errorDescription("Invalid URL, cannot test"));
            }
            else {
                dest.appendChild(errorDescription(e.message));
            }
        }
    }
    Nginx.runCheck = runCheck;
})(Nginx || (Nginx = {}));

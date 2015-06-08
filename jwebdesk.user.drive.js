define([
    "jwebkit",
    "jwebdesk"    
], function(jwk, jwebdesk) {        
    var $ = jwk.query;
    
    var ud_global = new jwk.Node();
    var interval_set;
    if (!interval_set) {
        interval_set = setInterval(function () {
            ud_global.trigger("save_if_dirty");
        }, 1.5 * 1000); // meter este valor en algún config
    }    
    
    window.addEventListener("beforeunload", function (e) {
        ud_global.trigger("save_if_dirty");
    });

    jwebdesk.UserDrive = function (owner) {
        // console.log("UserDrive", [owner], [jwk.global.whoami(true)]);
        var drive = this;
        drive._pending_writes = {length: 0};
        jwebdesk.Drive.call(this, owner, {
            title: "User",
            id: "user"
        });
        
        if (!owner) this.update().then(function () {            
            drive.flag_on("updated");
        });
        
        ud_global.on("save_if_dirty", function (n, e){
            this.sync();
        }, this);
    }
    jwebdesk.UserDrive.prototype = new jwebdesk.Drive();
    jwebdesk.UserDrive.prototype.constructor = jwebdesk.UserDrive;
    
    // Private auxiliar functions ---------------------------------------------------------------    
    // Esta función recibe la data de un readdir del api de jwebdesk.UserDrive de forma cruda como la maneja jwebdesk.UserDrive.
    // Hay que hacer una traducción de esta data a un formato unificado    
    function to_nodes (entries, parent) {
        var self = this;
        var nodes = [];
        for (var i=0;  i<entries.length; i++) {
            var entry = entries[i];
            var ext = entry.name.substring(entry.name.lastIndexOf(".") + 1);
            entry.mimeType = entry.mimeType || "";
            //*        
            var node = this.create_node(jwk.extend({        
                extension: ext != name ? ext : "",
                hasThumbnail: entry.hasThumbnail,
                icon: entry.isFolder ? "folder" : ext + " " + entry.mimeType.split("/")[0],
                parent: parent,
                size: entry.size,                
                // TODO: hay que formatear este campo
                modifiedAt: entry.modifiedAt                
            }, entry));
            
            if (entry.data) {
                node.setData(entry.data);
            }
            
            nodes.push(node);
        }

        
        // -- consistency check -----------------
        var files = [];
        var hashes = [];
        for (var i=0; i<nodes.length; i++) {
            var name = nodes[i].name;
            var hash = nodes[i].hash;
            if (files.indexOf(name) > -1) console.error("ERROR: children dupplicate entry: " + name, [nodes[i].fullpath()], arguments);
            if (hashes.indexOf(hash) > -1) console.error("ERROR: dupplicate hash: " + hash, [nodes[i].fullpath(), nodes[i].data], arguments);
            files.push(name);
            if (hash) hashes.push(hash);
        }
        // --------------------------------------        
        
        
        console.assert(nodes.length == entries.length, "ERROR: on create_node", arguments, [nodes, jwk.global.whoami(true)]);
        
        return nodes;
    }

    
    function format_data(data, parent, _level) {
        var self = this;
        var level = (typeof _level == "undefined" ) ? 3 : _level;        
        var entry, path, name, isFolder, size = "no size", modifiedAt = new Date();
        console.assert(parent, "ERROR: parent must exist: ", arguments);
        console.assert(!parent.children, "ERROR: parent already has children: ", arguments);
        parent.children = [];
        
        if (typeof data == "object") {
            for (var prop in data) {            
                name = prop;
                path = parent.path + "/" + prop;

                // en principio todas tienen el formato: /config/<owner>/<package_name>/<version>            
                isFolder = level > 0;            

                entry = {
                    name: name,
                    path: path,
                    isFolder: isFolder,
                    size: size,       
                    modifiedAt: modifiedAt
                };

                if (!isFolder) {
                    entry.data = JSON.stringify(data[prop], null, 4);
                }

                var lista = self.createNodes([entry], parent);
                // var lista = to_nodes.call(this, [entry], parent);
                /// console.log(lista[0].hash, lista[0].path, [lista[0].data])

                parent.setChildren(parent.children.concat(lista));
                if (isFolder && !Array.isArray(data[prop])) {
                    format_data.call(self, data[prop], parent.node(path), level-1);
                }
            }

            parent.setChildren(parent.children);
        } else {
            console.error("ERROR: data must be an object. Not a " + typeof data, [data]);
        }
        
        return parent;
    }

    jwebdesk.UserDrive.prototype.sync = function () {
        if (this._pending_writes.length > 0) {
            // console.log("jwebdesk.UserDrive.prototype.sync",[this._pending_writes]);
            var deferred = jwk.Deferred();
            
            var pathlist = [];
            var datalist = [];
            
            for (var fullpath in this._pending_writes) {
                var obj = this._pending_writes[fullpath];
                if (typeof obj != "object") continue;
                var node = obj.node;
                var path = node.path;
                var data = obj.data;
                var df = obj.deferred = obj.deferred || jwk.Deferred();
                var parsed_data;
                var branch = path.split("/")[1];
                
                try {
                    parsed_data = JSON.parse(data);      
                } catch (err) {
                    var e = {
                        error: "ERROR: JSON parse error",
                        source: data,
                        err: err
                    };
                    console.error("ERROR: ", e);
                    return df.reject(e).promise();
                }
                
                pathlist.push(path);
                datalist.push(data);
            }
            
            var ajax_params = {};
            ajax_params.type = "POST";
            ajax_params.url = jwebdesk.serverURL + "?action="+branch+"&op=writeall&apptoken=" + this._apptoken; 
            ajax_params.data = {pathlist: pathlist, datalist: datalist};            
            
    // console.error("jwebdesk.user.drive.sync() >>>> ", ajax_params);
            var drive = this;
            $.ajax(ajax_params).done(function (result) { 
                deferred.resolve(node);                
            }).fail(function (err){
                deferred.fail(err);
            });
            
            this._pending_writes = { length: 0};            
            
            return deferred.promise();
            
        } else {
            return jwk.Deferred().resolve().promise();
        }
    }
    
    function fetch(branch, drive, levels) {
        var deferred = jwk.Deferred();        
        var url = jwebdesk.serverURL + "?action="+branch+"&op=readall&apptoken=" + this._apptoken;
        $.ajax({url:url}).done(function (result) {            
            var obj = {error: "JSON parse error", source: result};
            try {
                obj = JSON.parse(result);
            } catch (err) {
                obj.err = err;
                console.error(obj.error, [obj.source, err.stack, err.message], result);
            }
            
            // Fix: arrays por objetos
            for (var i in obj) {
                var parent = obj[i];
                for (var j in parent) {
                    if (Array.isArray(parent[j]) && parent[j].length == 0) {
                        parent[j] = {};
                    }
                }
            }
            
            var root = drive.get("root");
            
            root.mkdir(branch).done(function () {
                var conf_node = format_data.call(drive, obj, root.node("/" + branch), levels);
                deferred.resolve(drive);
            });

        }).fail(function (err){
            deferred.fail(err);
        });
        return deferred.promise();
    }
    
    function fetch_profile(branch, drive, levels) {
        var deferred = jwk.Deferred();        
        var url = jwebdesk.serverURL + "?action="+branch+"&op=readall&apptoken=" + this._apptoken;
        $.ajax({url:url}).done(function (result) {            
            var obj = {error: "JSON parse error", source: result};
            try {
                obj = JSON.parse(result);
            } catch (err) {
                obj.err = err;
                console.error(obj.error, [err.stack, err.message], result);
            }
            
            // Fix: arrays por objetos
            for (var i in obj) {
                var parent = obj[i];
                for (var j in parent) {
                    if (Array.isArray(parent[j]) && parent[j].length == 0) {
                        parent[j] = {};
                    }
                }
            }
            
            var root = drive.get("root");
            
            root.mkdir(branch).done(function () {
                var conf_node = format_data.call(drive, obj, root.node("/" + branch), levels);
                deferred.resolve(drive);
            });

        }).fail(function (err){
            deferred.fail(err);
        });
        return deferred.promise();
    }
    
    
    jwebdesk.UserDrive.prototype.update = function () {
        var drive = this;
        var deferred = jwk.Deferred();
        
        $.when(fetch("config", drive, 3), fetch_profile("profile", drive, 0)).done(function (cofig, profile) {
            deferred.resolve();
        })
        return deferred.promise();
    }
    
    // jwebdesk.UserDrive API functions ----------------------------------------------------------------------
    
    jwebdesk.UserDrive.prototype.login = function () {
        return jwk.Deferred().resolve();
    }      
    
    jwebdesk.UserDrive.prototype.logout = function ()  {
        return jwk.Deferred().resolve();
    }
    
    jwebdesk.UserDrive.prototype.user = function ()  {
        console.error("jwebdesk.UserDrive.user", "Not implemented");
    }

    jwebdesk.UserDrive.prototype.root = function ()  {
        console.error("jwebdesk.UserDrive.root", "Not implemented");
    }

    jwebdesk.UserDrive.prototype.removeFile = function (node)  {
        // console.error("jwebdesk.UserDrive.prototype.removeFile y ahora?", console.log(node));
        var parent = node.parent;
        parent.remove_node(node);
        var drive = this;
        var deferred = jwk.Deferred();
        (function (_parent, _node) {
            drive.wait_flag("updated").done(function () {
                // console.log("writeFile anote un _pending_writes", [node.path, drive._apptoken]);
                drive._pending_writes[_node.fullpath()] = {
                    node: _node,
                    data: "null"
                }            
                drive._pending_writes.length++;
                deferred.resolve(_parent);
            });
        })(parent, node);
        
        return deferred.promise();
    }
        
    jwebdesk.UserDrive.prototype.writeFile = function (node, new_data, params)  {
        console.assert(node instanceof jwebdesk.Node, arguments);
        var deferred = jwk.Deferred();
        var drive = this;        
        try {
            JSON.parse(new_data);
        } catch (err) {
            var _e = "ERROR: JSON parse error: " + err.message;
            console.errro(_e);
            return deferred.reject(_e).promise();
        }
        
        this.wait_flag("updated").done(function () {
            // console.log("writeFile anote un _pending_writes", [node.path, drive._apptoken]);
            drive._pending_writes[node.fullpath()] = {
                node: node,
                data: new_data
            }            
            node.setData(new_data);
                
            drive._pending_writes.length++;
            deferred.resolve(node);
        });
        return deferred.promise();
        
        /*
        //  El siguiente código salvaba los nodos de uno y a demanda.    
        
        var deferred = jwk.Deferred();
        this.wait_flag("updated").done(function () {
            var parsed_data;
            try {
                parsed_data = JSON.parse(new_data);      
            } catch (err) {
                return deferred.reject({
                    error: "ERROR: JSON parse error",
                    source: new_data,
                    err: err
                }).promise();
            }

            //node.path
            //node.data = new_data;
            //node.data_fetched = true;        
            var params = {};        
            params.url = jwebdesk.serverURL + "?action=config&op=writenode&apptoken=" + this._apptoken;
            params.type = "POST";
            //params.data = {data: '{"value": '  + new_data + '}', path: node.path};
            params.data = {data: new_data, path: node.path};
            $.ajax(params).done(function (result) { 
                deferred.resolve(node);
            }).fail(function (err){
                deferred.fail(err);
            });
        });
        return deferred.promise();
        */
    }    
    
    jwebdesk.UserDrive.prototype.readFile = function (node, params) {
        // console.error("jwebdesk.UserDrive.readFile ????", [node.path], arguments);
        return this.wait_flag("updated").then(function (){
            return jwk.Deferred().resolve(node.data, node).promise();
        });        
    }
    
    jwebdesk.UserDrive.prototype.readdir = function (node)  {
        // console.error("jwebdesk.UserDrive.readdir ????", [node.path], arguments);
        return this.wait_flag("updated").then(function (){
            var deferred = jwk.Deferred();
            console.log("node.children: ", node.children, node.path);
            if (node.children && node.children.length != 0) {
                deferred.resolve(node.children, node);
            } else {
                deferred.reject("ni idea");
            }
            return deferred.promise();
        });
    }

    jwebdesk.UserDrive.prototype.getAPI = function ()  {
        console.error("jwebdesk.UserDrive.getAPI", "Not implemented");
    }

    jwebdesk.UserDrive.prototype.link = function ()  {
        console.error("jwebdesk.UserDrive.link", "Not implemented");
    }
    
    jwebdesk.UserDrive.prototype.thumbnail = function ()  {
        console.error("jwebdesk.UserDrive.thumbnail", "Not implemented");
    }     
    
    return jwebdesk.UserDrive;
});
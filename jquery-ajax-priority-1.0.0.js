/**
 * @preserve jquery-ajax-priority-v1.0.0
 * version 1.0.0 - 10 Apr 2016
 * Kingston Chan - kgston@hotmail.com
*/
(function($) {
    var $ajax = $.ajax; //Store the original jQuery ajax function
    var ajaxQueue = [];
    
    var prioritySettings = $.ajaxPriority = {
        debug: true,        //Debug output
        maxConnections: 6,  //Max number of simultainous connections to restrict to
        defaultPriority: 5, //Default priority level if dataType is not specified
        typePriority: {     //List of dataType keys with their individual default priority levels
            html: 5,
            xml: 5,
            script: 5,
            text: 4,
            json: 0,
            jsonp: 0
        }
    };
    prioritySettings.active = 0; //Internal use only - Number of active connections
    
    //Overwrite the ajax api and reaplace it with this
    $.ajax = function(arg1, arg2) {
        var settings;
        
        //Convert the dual args parameters into a single arg
        //If its too weird, just throw it straight to jQuery
        if(typeof arg1 === "object" && arg1 != null) {
            settings = arg1;
        } else if(typeof arg1 === "string" && !arg2) {
            settings = {url: arg1};
        } else if(typeof arg1 === "string" && typeof arg2 === "object" && arg2 != null) {
            settings = arg2;
            settings.url = arg1;
        } else {
            return $ajax(arg1, arg2);
        }
        
        //If there are avaliable connections, uses the beforeSend callback or async is false, throw it straight to jQuery
        if(prioritySettings.active < prioritySettings.maxConnections || 
            settings.beforeSend ||
            settings.async === false) {
            prioritySettings.active++;
            return $ajax(settings).always(executeNextAjax);
        } else {
            //Otherwise, set the priority level
            setPriority(settings);
            if(getPriority(settings) === 0) { //If it is 0, run it now
                log("Request was executed immediately");
                prioritySettings.active++;
                return $ajax(settings).always(executeNextAjax);
            }
            
            //If it has a normal priority level, cheate the queued ajax object
            var queuedAjax = {
                settings: settings, //Store the passed in settings
                callback: $.Deferred() //Create a deferred trigger for when the ajax response is created
            };
            queuedAjax.promise = queuedAjax.callback.promise(); //Build the subsitute ajax response
            bindAjaxPassthroughFunctions(queuedAjax.promise); //Bind all the passthrough functions to the subsitute
            
            var insertionIndex = getQueueIndex(ajaxQueue, getPriority(settings)); //Determine the insertion index in the queue
            ajaxQueue.splice(insertionIndex, 0, queuedAjax); //Splice the queued ajax object into the queue based on the insertion index determined
            log("Added to queue index: " + insertionIndex);
            
            //If there are no active connections, kick it off now.
            //This can happen when the maxConnections is set as 0 to force everything into a queue before execution
            if(prioritySettings.active == 0) {
                prioritySettings.active++;
                executeNextAjax();
            }
            return queuedAjax.promise; //Return the subsitute ajax response
        }
        
        /*
        Executes the next queuedAjax object on the top of the ajaxQueue if avaliable, and applies all 
        params: promise [Deferred.promise] - The promise object that will be returned to the $.ajax
        returns: undefined
        */
        function executeNextAjax() {
            prioritySettings.active--;                                      //Decrement the active counter
            //If there is a queued ajax request and there are avaliable connections
            if(ajaxQueue.length > 0 && 
                (prioritySettings.active < prioritySettings.maxConnections)) {
                prioritySettings.active++;                                  //Increment the active counter
                var nextAjax = ajaxQueue.shift();                           //Get the next ajax request from the top of the queue
                var ajaxResponse = $ajax(nextAjax.settings)                 //Create the ajax request with the underlying jQuery ajax
                    .always(executeNextAjax)                                //Decrement the counter when done and check if more requests are avaliable
                    .done(nextAjax.callback.resolve)                        //Trigger if successful *args are passed through automatically
                    .fail(nextAjax.callback.reject);                        //Trigger if not successful *args are passed through automatically
                nextAjax.promise.applyPassthroughFunctions(ajaxResponse);   //Apply all passthrough functions
            }
        }
        
        /*
        Method to cahce ajax functions args to actual ajax object when it is eventually created
        This will bind all keys in functionArgsMap to the promise with a generic function that will cache the args
        The args in the functionArgsMap is stored as an array of arrays to allow for mulitple calls on the same function
        Use promise.applyPassthroughFunctions(actualAjaxObj) to execute all cached args on the actual ajax object when created
        All future function calls to the promise will passthrough directly to the actual ajax object
        params: promise [Deferred.promise] - The promise object that will be returned to the $.ajax
        returns: undefined
        */
        function bindAjaxPassthroughFunctions(promise) {
            var realAjax = null; //When the real ajaxResponse is set via applyPassthroughFunctions, it goes here
            //Map of all ajax response function keys, add new ones here with a null value
            var functionArgsMap = {
                abort: null,
                always: null,
                complete: null,
                done: null,
                error: null,
                fail: null,
                getAllResponseHeaders: null,
                getResponseHeader: null,
                overrideMimeType: null,
                pipe: null,
                progress: null,
                promise: null,
                setRequestHeader: null,
                success: null,
                then: null,
                statusCode: null
            };
            
            //For each key on the map, create a generic function that will 
            //1. Store the passed through args and apply it later when the real ajax response is set OR
            //2. If the real ajax response is avaliable, directly pass through the command and return the response
            //Certain functions like getResponseHeader will not work as expected when the ajax has not returned
            Object.keys(functionArgsMap).forEach(function(functionName) {
                promise[functionName] = function() {
                    var args = Array.prototype.slice.call(arguments);
                    if(realAjax) {
                        return realAjax[functionName].apply(realAjax, args);
                    } else {
                        if(functionArgsMap[functionName] == null) functionArgsMap[functionName] = [];
                        functionArgsMap[functionName].push(args);
                        return promise;
                    }
                }
            });
            
            //Internally used function to set the real ajax response on the interim promise
            promise.applyPassthroughFunctions = function applyPassthroughFunctions(ajax) {
                realAjax = ajax;
                //Apply all args in cache to the real ajax response
                Object.keys(functionArgsMap).forEach(function(functionName) {
                    if(Array.isArray(functionArgsMap[functionName])) {
                        functionArgsMap[functionName].forEach(function(functionArgs) {
                            ajax[functionName].apply(ajax, functionArgs);
                        });
                    }
                });
            }
        }
        
        /*
        Gets the correct queue index by priority for splicing using binary search
        params: ajaxQueue [Array] - The queue to search in
                priority [int] - The priority level
                fromIdx? [int] - Starting search index
                toIdx? [int] - Ending search index
        returns: [int] The index to splice at
        */
        function getQueueIndex(ajaxQueue, priority, fromIdx, toIdx) {
            var nextIdx = 0; 
            if(ajaxQueue.length == 0) return nextIdx; //Shortcut, if the queue is empty, just return the first index
            
            //Only enter if it is the first call
            if(fromIdx == null || toIdx == null) {
                //Shortcut, if the last value of the queue is the same or less, just return the last index of the queue
                if(getPriority(ajaxQueue[ajaxQueue.length - 1].settings) <= priority) return ajaxQueue.length;
                //Shortcut, if the first value of the queue is larger, just return the first index
                else if(getPriority(ajaxQueue[0].settings) > priority) return 0;
                
                //Otherwise just set the start and end search index and the whole queue
                fromIdx = 0;
                toIdx = ajaxQueue.length - 1;
            } else if(toIdx - fromIdx == 1) {
                //If the difference of the resultent index is 1, return the end index
                return toIdx;
            }
            //Find the next search index which is the middle of the search range
            nextIdx = Math.round((toIdx - fromIdx) / 2) + fromIdx;
            
            //If the search index's value is the same or less, look in the bottom half
            if(getPriority(ajaxQueue[nextIdx]) <= priority) {
                return getQueueIndex(ajaxQueue, priority, nextIdx, toIdx);
            } else { //Otherwise, look in the top half
                return getQueueIndex(ajaxQueue, priority, fromIdx, nextIdx);
            }
        }
        
        /*
        Gets the priority level from the jquery settings object
        params: settings [Object] - The jQuery Ajax settings object
        returns: [int] the priority value
        */
        function getPriority(settings) {
            return settings.priority;
        }
        
        /*
        Automatically sets the priority level into the jquery settings object based on the ajaxPriority settings
        params: settings [Object] - The jQuery Ajax settings object
        returns: undefined
        */
        function setPriority(settings) {
            if(settings.priority) return; //If the value exists, use the existing value
            //Check if the dataType has a default prioirty declared and use it
            if(prioritySettings.typePriority[settings.dataType] != null) {
                settings.priority = prioritySettings.typePriority[settings.dataType];
            } else { //Otherwise use tge default
                settings.priority = prioritySettings.defaultPriority;
            }
            log("Setting ajax call of type: " + settings.dataType + " to: " + settings.url + " with priority: " + settings.priority);
        }
        
        /*
        Logs the message to the console based on the debug flag
        params: message [String] - The message to display
        returns: undefined
        */
        function log(message) {
            if(prioritySettings.debug) console.log("Ajax Priority [debug]: " + message);
        }
    };
})(jQuery);
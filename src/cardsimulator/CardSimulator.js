'use strict';
var nconf = require('nconf');
//Get the device number from the arguments
var devnum = process.argv[[2]] || '01';
var ProgressBar = require('progress');

// Utility to process keystrokes
var keypress = require('keypress');
keypress(process.stdin);
process.stdin.setRawMode(true);
var colors = require('colors');

// Load the configuration file
nconf.use('file', { file: '../card_config/card' + devnum + '_config.json' });
nconf.load();

console.log("Press 'q' to quit.")

var printMessage= function(message){
	var cardinfo = nconf.get("DeviceID") + ": " + nconf.get("cardProperties:FaceValue") 
					+ "@" + nconf.get("handProperties:HandLocName") + "," + nconf.get("handProperties:HandLocSub");
	console.log(cardinfo.green + "$ " + message.white);
}


printMessage("Loading... ")

var Client = require('azure-iot-device').Client;
var Protocol = require('azure-iot-device-mqtt').Mqtt;

var connectionString = nconf.get('ConnectionString');
var client = Client.fromConnectionString(connectionString, Protocol);

var initCardChange = function(twin) {
    var currentCardProperties = twin.properties.reported.cardProperties;
    currentCardProperties.pendingConfig = twin.properties.desired.cardProperties;
    currentCardProperties.status = "Pending";

    var patch = {
		deviceStatus: "Shuffling",
		cardProperties: currentCardProperties
    };
	nconf.set("deviceStatus","Shuffling");
    twin.properties.reported.update(patch, function(err) {
        if (err) {
            printMessage('Could not report properties');
        } else {
			
            printMessage('Reported pending card change to: ' + patch.cardProperties.pendingConfig.FaceValue);
			
			nconf.set('cardProperties', currentCardProperties);	
			nconf.save(function (err) {
				if (err) {
				  printMessage(err.message);
				  return;
				}
				//console.log('Configuration saved successfully.');
			});
			
			
			var dealTime = 60000;
			var bar = new ProgressBar('Dealing :bar :percent'.yellow, {total:10});
			printMessage('Expected change time ' + dealTime/1000 + ' seconds');
			var timer = setInterval(function () {
			  bar.tick();
			  if (bar.complete) {
				
				clearInterval(timer);
			  }
			}, dealTime/10.1);
						
            setTimeout(function() {completeCardChange(twin);}, dealTime);
        }
    });
}

var completeCardChange =  function(twin) {
    var currentCardProperties = twin.properties.reported.cardProperties;
    currentCardProperties.CardID = currentCardProperties.pendingConfig.CardID;
	currentCardProperties.FaceValue = currentCardProperties.pendingConfig.FaceValue;
	currentCardProperties.CardTransMult = currentCardProperties.pendingConfig.CardTransMult;
	currentCardProperties.CardOccLevel = currentCardProperties.pendingConfig.CardOccLevel;
    currentCardProperties.status = "Success";
		
    delete currentCardProperties.pendingConfig;

    var patch = {
		deviceStatus: "Ready",
        cardProperties: currentCardProperties
    };
	nconf.set("deviceStatus","Ready");
    patch.cardProperties.pendingConfig = null;

	nconf.set('cardProperties', currentCardProperties);	
	nconf.save(function (err) {
		if (err) {
		  printMessage(err.message);
		  return;
		}
		//console.log('\nConfiguration saved successfully.');
	});
	
	
    twin.properties.reported.update(patch, function(err) {
        if (err) {
            printMessage('Error reporting properties: ' + err);
        } else {
			printMessage('Reported completed change.')
            //console.log('Reported completed config change: ' + JSON.stringify(patch));
        }
    });
};

var initHandChange = function(twin) {
    var currentHandProperties = twin.properties.reported.handProperties;
    currentHandProperties.pendingConfig = twin.properties.desired.handProperties;
    currentHandProperties.status = "Pending";

    var patch = {
		deviceStatus: "Moving",
		handProperties: currentHandProperties
    };
	nconf.set("deviceStatus","Moving");
    twin.properties.reported.update(patch, function(err) {
        if (err) {
            printMessage('Could not report properties');
        } else {
			//console.log(JSON.stringify(patch));
            printMessage('Reported pending move to: ' + patch.handProperties.pendingConfig.HandLocName + "," + patch.handProperties.pendingConfig.HandLocSub);
			
			nconf.set('handProperties', currentHandProperties);	
			nconf.save(function (err) {
				if (err) {
				  console.error(err.message);
				  return;
				}
				//console.log('\nConfiguration saved successfully.');
			});
			
			var bar = new ProgressBar('Moving :bar :percent'.yellow, {total:10});
			var moveTime = 60000 + 10000 * currentHandProperties.Distance;
			printMessage('Expected move time ' + moveTime/1000 + ' seconds');
			var timer = setInterval(function () {
			  bar.tick();
			  if (bar.complete) {
				//console.log('\nComplete\n');
				clearInterval(timer);
			  }
			}, moveTime/10.1);
			

			
            setTimeout(function() {completeHandChange(twin);}, moveTime);
        }
    });
}

var completeHandChange =  function(twin) {
    var currentHandProperties = twin.properties.reported.handProperties;
    currentHandProperties.HandID = currentHandProperties.pendingConfig.HandID;
	currentHandProperties.HandLocName = currentHandProperties.pendingConfig.HandLocName;
	currentHandProperties.HandLocSub = currentHandProperties.pendingConfig.HandLocSub;
	currentHandProperties.HandLocLat = currentHandProperties.pendingConfig.HandLocLat;
    currentHandProperties.HandLocLon = currentHandProperties.pendingConfig.HandLocLon;
	currentHandProperties.Distance = 0.0;
	
	currentHandProperties.status = "Success";
    delete currentHandProperties.pendingConfig;
	
    var patch = {
		deviceStatus: "Ready",
        handProperties: currentHandProperties
    };
	nconf.set("deviceStatus","Ready");
    patch.handProperties.pendingConfig = null;
	nconf.set('handProperties', currentHandProperties);	
	nconf.save(function (err) {
		if (err) {
		  printMessage(err.message);
		  return;
		}
		//console.log('Configuration saved successfully.');
	});
    twin.properties.reported.update(patch, function(err) {
        if (err) {
            printMessage('Error reporting properties: ' + err);
        } else {
            printMessage('Reported Completed move.');
        }
    });
};

var completedShutdown =  function(twin) {
    
    var patch = {
		deviceStatus: "Offline"
    };
	nconf.set("deviceStatus","Offline");

	nconf.save(function (err) {
		if (err) {
		  printMessage(err.message);
		  return;
		}
		printMessage('Final configuration saved successfully.');
	});
	
	
    twin.properties.reported.update(patch, function(err) {
        if (err) {
            printMessage('Error reporting properties: ' + err);
        } else {
            printMessage('Reported completed config change');
			client.close();
			process.exit();
        }
    });
	
	
};


//
// Initialize card based on what we currently have in the configuration file
//

client.open(function(err) {
    if (err) {
        printMessage('could not open IotHub client');
    } else {
        client.getTwin(function(err, twin) {
            if (err) {
                printMessage('could not get twin');
            } else {
                printMessage('Retrieved device twin');
				
				twin.properties.reported.cardProperties = nconf.get('cardProperties');
				twin.properties.reported.handProperties = nconf.get('handProperties');
				
				var patch = {
					deviceStatus: "Ready",
					cardProperties: twin.properties.reported.cardProperties,
					handProperties: twin.properties.reported.handProperties
				};
				
				
				
				twin.properties.reported.update(patch, function(err) {
					if (err) {
						printMessage('Error reporting properties: ' + err);
					} else {
						printMessage('Successfully reported initialization properties.');
					}
				});
				
				
				
                twin.on('properties.desired.cardProperties', function(desiredChange) {
                    
                    var currentCardProperties = twin.properties.reported.cardProperties;
                    if (desiredChange && desiredChange.CardID !== currentCardProperties.CardID) {
						var newCardValue = desiredChange.FaceValue;
						printMessage("Card change requested to: " + newCardValue);
                        initCardChange(twin);
                    }
                });
				
				twin.on('properties.desired.handProperties', function(desiredChange) {
                    
                    var currentHandProperties = twin.properties.reported.handProperties;
                    if (desiredChange && desiredChange.HandID !== currentHandProperties.HandID) {
						var newLocation = desiredChange.HandLocName + "," + desiredChange.HandLocSub;
						printMessage("Card move requested to: "+ newLocation);
                        initHandChange(twin);
                    }
                });
				nconf.set("deviceStatus","Ready");
				nconf.save(function (err) {
						if (err) {
						  printMessage(err.message);
						  return;
						}
						//console.log('Configuration saved successfully.');
					});
				
				
				process.stdin.on('keypress', function (ch, key){
					if (key && key.name == 'q'){
						//update the device to offline and quit
						printMessage('Shutting down device');
						var patch = {
							deviceStatus: "Shutting Down"
						};	
						nconf.set("deviceStatus","Shutting Down");
						
						twin.properties.reported.update(patch, function(err) {
							if (err) {
								printMessage('Could not report properties');
							} else {
								printMessage('Reported pending shutdown...');
								
								nconf.save(function (err) {
									if (err) {
									  console.error(err.message);
									  return;
									}
									//console.log('Configuration saved successfully.');
								});
								
								
								var shutdowntime = 20000;
								var bar = new ProgressBar('Shutting Down :bar :percent'.red, {total:10});

								var timer = setInterval(function () {
								  bar.tick();
								  if (bar.complete) {
									//console.log('\nComplete\n');
									clearInterval(timer);
								  }
								}, shutdowntime/10.1);
											
								setTimeout(function() {completedShutdown(twin);}, shutdowntime);
								
							}
						});
						
					}
					
				});
				
				
            }
        });
    }
});
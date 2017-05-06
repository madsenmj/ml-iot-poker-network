'use strict';
// Get hand configuration information
var nconf = require('nconf');
nconf.use('file', { file: 'hand_config.json' });
nconf.load();


var  us = require("underscore");
//console.log(us.sample(nconf.get('Cards'),4));
var randgen = require("randgen");

// Set up keypress tools
var keypress = require('keypress');
keypress(process.stdin);
process.stdin.setRawMode(true);
// Set up http POST tools for querying Azure ML
var http = require("http");
var https = require("https");
var querystring = require("querystring");
var fs = require('fs');
var uuidV4 = require('uuid/v4');


var host = 'ussouthcentral.services.azureml.net'

//This endpoint is a card trade test- it trades cardes without optimization
//var path = '/subscriptions/36f6dd103ad84a1fb066922d7386a1f8/services/3118aed11b044ddb97c5bd5a40876a34/execute?api-version=2.0&format=swagger'
//var api_key = 'salIPqRQ1k+DFDq1cPz8ddYB9lPttvYAbAfkOL4FD7m2e68ed7/v0CkNBQHg2hcf16kLBJyraN1ufE/HUlLZ4w=='

//This endpoint is the Hand Optimizer endpoint
var path = '/subscriptions/36f6dd103ad84a1fb066922d7386a1f8/services/4ce7bf2b37aa4e048363664482792c6b/execute?api-version=2.0&format=swagger';
var api_key = 'S7vLTuUj2a7KvQj+yShqK04jSuvUhHt8+pT5NW7h+/scFe2iEcqXM7dl7gg0uek2tw6WnaNddqQFnws1ILxkWw==';

// Set up Azure IoT Hub tools
var iothub = require('azure-iothub');
var connectionString = 'HostName=madsenIoTv4.azure-devices.net;SharedAccessKeyName=iothubowner;SharedAccessKey=Ahgqq7Utd+8wcXISW50d49+Ojh5LbJY7xGBXXXCW124=';
var registry = iothub.Registry.fromConnectionString(connectionString);


function updateDeviceTwins(cardArray){
	
	
	cardArray.forEach(function(entry) {
		console.log("\n");
		//console.log(entry.CardID);
		var querystring = "SELECT * FROM devices WHERE properties.reported.cardProperties.CardID='" + entry.CardID + "'";
		var query = registry.createQuery(querystring, 100);
		query.nextAsTwin(function(err, results) {
				if (err) {
					console.error('Failed to fetch the results: ' + err.message);
				} else {
					results.forEach(function(twin) {
						if(twin.properties.reported.cardProperties.CardID == entry.CardID){
							console.log("Device : " + twin.deviceId + ' should be moving');
							
							var patch = {
								properties : {
									desired: {
										handProperties: { 
											HandID: entry.MoveHandID,
											HandLocName: entry.MoveHandLocName,
											HandLocSub: entry.MoveHandLocSub,
											HandLocLat: entry.MoveHandLocLat,
											HandLocLon: entry.MoveHandLocLon,
											Distance: entry.Distance
										}
									}
								}
							};
							twin.update(patch, function(err) {
								if (err) {
									console.error('Could not update twin: ' + err.constructor.name + ': ' + err.message);
								} else {
									console.log(twin.deviceId + ' twin updated successfully');
								}
							});
							
						}
					});
				}
			});
	});
	
}


// Get the prediction data from teh Azure ML endpoint. 
function getPred(data) {

	console.log('===Get Trades===');
	var dataString = JSON.stringify(data)
	var method = 'POST'
	var headers = {'Content-Type':'application/json', 'Authorization':'Bearer ' + api_key};

	var options = {
		host: host,
		port: 443,
		path: path,
		method: 'POST',
		headers: headers
	};
/*
	console.log('data: ' + dataString);
	console.log('method: ' + method);
	console.log('api_key: ' + api_key);
	console.log('headers: ' + JSON.stringify(headers));
	console.log('options: ' + JSON.stringify(options));
*/

	var reqPost = https.request(options, function (res) {
/*		
		console.log('===reqPost()===');
		console.log('StatusCode: ', res.statusCode);
		console.log('headers: ', res.headers);
*/
		res.on('data', function(d) {
			// When we receive data back from the ML endpoint, run this to process it
			console.log('===Received Response===');
			//process.stdout.write(d);
			var results = JSON.parse(d);
			if (results.Results.output1){
				console.log('===Now Trading===');
				var cardarray = JSON.parse(results.Results.output1[0].cardData);
				console.log("Received Total Score Update from " + results.Results.output1[0].OriginalScore + " to a score of " + results.Results.output1[0].FinalScore);
				updateDeviceTwins(cardarray);
			} else{
				console.log('Error');
				process.stdout.write(d);
			}

		});

	}); 
	
	// Send the request
	reqPost.write(dataString);
	reqPost.end();
	reqPost.on('error', function(e){
		console.error(e);
	});


}

function send404Reponse(response) {
	response.writeHead(404, {"Context-Type": "text/plain"});
	response.write("Error 404: Page not Found!");
	response.end();
}

function onRequest(request, response) {
	if(request.method == 'GET' && request.url == '/' ){
		response.writeHead(200, {"Context-Type": "text/plain"});
		fs.createReadStream("./index.html").pipe(response);
	}else {
		send404Reponse(response);
	}
}

//Set up the local server to listen for responses from the Azure ML endpoint
http.createServer(onRequest).listen(8050);
console.log("Server is now running on port 8050");

// Start the preparations for running a Trade operation. First step: find the cards ready to trade
var setupMLQuery = function() {
    var query = registry.createQuery("SELECT * FROM devices WHERE properties.reported.deviceStatus = 'Ready'", 100);
	
    query.nextAsTwin(function(err, results) {
        if (err) {
            console.error('Failed to fetch the results: ' + err.message);
        } else {
			var cardData = [];
			
            console.log();
            results.forEach(function(twin) {
				//console.log(JSON.stringify(twin.properties.reported, null, 2));
				var deviceStatus = twin.properties.reported.deviceStatus;
                console.log("Device: " + twin.deviceId + ' is: ' + deviceStatus);
				var cardinfo = { //TODO: build up the information we need to send to the ML learning endpoint
					FaceValue : twin.properties.reported.cardProperties.FaceValue,
					CardID: twin.properties.reported.cardProperties.CardID,
					CardTransMult: twin.properties.reported.cardProperties.CardTransMult,
					CardOccLevel: twin.properties.reported.cardProperties.CardOccLevel,
					HandID: twin.properties.reported.handProperties.HandID,
					HandLocName: twin.properties.reported.handProperties.HandLocName,
					HandLocSub: twin.properties.reported.handProperties.HandLocSub,
					HandLocLat: twin.properties.reported.handProperties.HandLocLat,
					HandLocLon: twin.properties.reported.handProperties.HandLocLon

				};
				cardData.push(cardinfo);
				
                /*
				var desiredConfig = twin.properties.desired.cardProperties;
                var reportedConfig = twin.properties.reported.cardProperties;

                console.log("Desired: ");
                console.log(JSON.stringify(desiredConfig, null, 2));
                console.log("Reported: ");
                console.log(JSON.stringify(reportedConfig, null, 2));
				*/
            });
			var date = new Date();
			// Data format required by the Azure ML endpoint
			var data = 
				{
				  "Inputs": {
					"input1": [
					  {
						"batchRequestTime": date.toISOString(),
						"batchID": uuidV4(),
						"cardData": JSON.stringify(cardData)
					  }
					]
				  },
				  "GlobalParameters": {}
				}
			
			console.log(JSON.stringify(data));
				
			getPred(data);

        }
    });
};

// Query the IoT hub to get the status of all the devices
var queryTwins = function() {
    var query = registry.createQuery("SELECT * FROM devices", 100);
	//var query = registry.createQuery("SELECT * FROM devices WHERE properties.reported.cardProperties.CardID='08b44343-6beb-4c24-997a-ee20c4e8ed06'", 100);
	
    query.nextAsTwin(function(err, results) {
        if (err) {
            console.error('Failed to fetch the results: ' + err.message);
        } else {
            console.log();
			console.log("Found N devices: " + results.length);
            results.forEach(function(twin) {
				//console.log(JSON.stringify(twin.properties.reported, null, 2));
				var deviceStatus = twin.properties.reported.deviceStatus;
                console.log("Device: " + twin.deviceId + ' is: ' + deviceStatus);
				//console.log(JSON.stringify(twin.properties));
                /*
				var desiredConfig = twin.properties.desired.cardProperties;
                var reportedConfig = twin.properties.reported.cardProperties;

                console.log("Desired: ");
                console.log(JSON.stringify(desiredConfig, null, 2));
                console.log("Reported: ");
                console.log(JSON.stringify(reportedConfig, null, 2));
				*/
            });
        }
    });
};


var dealHands = function () {
	// First, get the devices that report that they are ready for a command
	var query = registry.createQuery("SELECT * FROM devices WHERE properties.reported.deviceStatus = 'Ready'", 100);	
	//We will get the twin iterator from this result
	query.nextAsTwin(function(err, results) {
        if (err) {
            console.error('Failed to fetch the results: ' + err.message);
        } else {
            console.log();
			console.log("Found N devices: " + results.length);
			
			var ndevices = results.length;
			

			var nhands = Math.floor(ndevices/5);
			var remainder = ndevices % 5;
			

			
			// At this point we need to figure out what the hands are going to look like
			// Then, we run through all the results and implement each card change
			// We build the hand information and put it in the dealData array
			var dealData = [];
			
			for (var ihand = 0; ihand < nhands ; ihand++ ){
				var handinfo = us.sample(nconf.get('Locations'),1)[0];
				// Set up the information common to all the cards in the hand
				var handData = { HandID: uuidV4(),
								HandLocName: handinfo.Name,
								HandLocSub: us.sample(nconf.get('Rooms')),
								HandLocLat: handinfo.Lat,
								HandLocLon: handinfo.Lon,
								Distance: 0.0
							};
				//console.log("HandData: " + JSON.stringify(handData));
				var cardsinhand = 5;
				if (ndevices < 10){
					cardsinhand = ndevices;
				}else{
					if (remainder > 1){
						 cardsinhand = 7;
						 remainder = remainder - 2;
					}
					else if (remainder > 0){
						cardsinhand = 6;
						remainder = remainder - 1;
					}
				}
				
				//console.log("cardsinhand : " + cardsinhand);
				//Shuffle the deck for this hand
				var handcards = us.sample(nconf.get('Cards'),cardsinhand);

				for (var icard = 0; icard < cardsinhand; icard++){
					//console.log('Hand: ' + ihand + ' card ' + icard);
					// build the card information based on the shuffle of the deck for this hand
					var cardData = {
									CardID: uuidV4(),
									FaceValue: handcards[icard],
									CardTransMult: Math.round((Math.random() * ( 1 + randgen.rpoisson(0.5)))*100)/100,
									CardOccLevel: 1000 * randgen.rpoisson(0.1)
								};
								
					//console.log("card: " + JSON.stringify(cardData));
					
					var properties = {desired: {
						cardProperties: cardData,
						handProperties: handData,
						
					}};
					//Push the card on to the stack to deal out to the devices
					dealData.push(properties);
					
				}
			}
			var icard = 0;
			
            results.forEach(function(twin) {
				// build the patch for the twin based on our new deal information
				var patch = {
					properties: dealData[icard]
				};		
				
				console.log("Patching Device: " + twin.deviceID + " with: " + JSON.stringify(patch));
				
				icard++;
				
				twin.update(patch, function(err) {
					if (err) {
						console.error('Could not update twin: ' + err.constructor.name + ': ' + err.message);
					} else {
						console.log(twin.deviceId + ' twin updated successfully');
					}
				});
				
            });
        }
    });
	
};

setInterval(queryTwins, 5000);

process.stdin.on('keypress', function (ch, key){
	if (key && key.name == 't'){
		// Gather information to send to the Azure ML endpoint to get trade info.
		console.log('Preparing to Trade');
		
		setupMLQuery();
		
	}
	else if (key && key.name == 'q'){
		console.log('Shutting down');
		process.exit();
	}
	else if (key && key.name =='d'){
		dealHands();
	}
});


/*registry.getTwin('deviceID01', function(err, twin){
    if (err) {
        console.error(err.constructor.name + ': ' + err.message);
    } else {
        
		var newCardId = uuid.v4();
        var patch = {
          properties: {
            desired: {
                    cardProperties: {
                        CardID: newCardId,
                        FaceValue: '4h',
						CardTransMult:0.333,
						CardOccLevel:0
                    }
                }
         }
        }
		
		
		var newHandId = uuid.v4();
        var patch = {
          properties: {
            desired: {
                    handProperties: {
                        HandID: newHandId,
                        HandLocName: "New York/New York",
                        HandLocSub: "R5T5H5",
						HandLocLat: 36.1047,
						HandLocLon: -115.1686,
						Distance: 4.3
                    }
                }
         }
        }
		
		
        twin.update(patch, function(err) {
            if (err) {
                console.error('Could not update twin: ' + err.constructor.name + ': ' + err.message);
            } else {
                console.log(twin.deviceId + ' twin updated successfully');
            }
        });
		
		
        
    }
});*/

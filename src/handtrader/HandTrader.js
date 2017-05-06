'use strict';

// Set up http POST tools for querying Azure ML
var http = require("http");
var https = require("https");
var querystring = require("querystring");
var fs = require('fs');
var uuidV4 = require('uuid/v4');
var nconf = require('nconf');
nconf.use('file', { file: 'trade_config.json' });
nconf.load();

//This endpoint is a card trade test- it trades cardes without optimization
var host = nconf.get('Host');
var path = nconf.get('Path');
var api_key = nconf.get('Api_key');

// Set up Azure IoT Hub tools
var iothub = require('azure-iothub');
var connectionString = nconf.get('ConnectionString');
var registry = iothub.Registry.fromConnectionString(connectionString);


function updateDeviceTwins(cardArray){
	var ntrades = cardArray.length;
	var tradesdone = 0;
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
									tradesdone = tradesdone + 1;
									console.log("Finished Trades: " + tradesdone);
									if (tradesdone >= ntrades){
										console.log("Finished Trading.");
										process.exit();
									}
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

	console.log('===getPred()===');
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
			console.log('===Received Prediction===');
			process.stdout.write(d);
			var results = JSON.parse(d);
			var cardarray = JSON.parse(results.Results.output1[0].cardData);
			updateDeviceTwins(cardarray);
			res.emit('end');
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
			
			//console.log(JSON.stringify(data));
				
			getPred(data);

        }
    });
};
setupMLQuery();




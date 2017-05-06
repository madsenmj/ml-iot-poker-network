'use strict';
var uuidV4 = require('uuid/v4');
//uuidV4()

// Get hand configuration information
var nconf = require('nconf');
nconf.use('file', { file: 'hand_config.json' });
nconf.load();

//console.log('Config Locations ' + JSON.stringify(nconf.get('Locations')));

var  us = require("underscore");
//console.log(us.sample(nconf.get('Cards'),4));

var randgen = require("randgen");

// Set up Azure IoT Hub tools
var iothub = require('azure-iothub');
var connectionString = nconf.get('ConnectionString');
var registry = iothub.Registry.fromConnectionString(connectionString);

// Query the IoT hub to get the status of all the devices
var queryTwins = function() {
    var query = registry.createQuery("SELECT * FROM devices", 100);
    query.nextAsTwin(function(err, results) {
        if (err) {
            console.error('Failed to fetch the results: ' + err.message);
        } else {
            console.log();
			
            results.forEach(function(twin) {
				//console.log(JSON.stringify(twin.properties.reported, null, 2));
				var deviceStatus = twin.properties.reported.deviceStatus;
                console.log("Device: " + twin.deviceId + ' is: ' + deviceStatus);
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

var handtester = function(){
	var dealData = [];
	
	var ndevices = 10;
	var nhands = Math.floor(ndevices/5);
	var remainder = ndevices % 5;
	
	// At this point we need to figure out what the hands are going to look like
	// Then, we run through all the results and implement each card change
	
	
	for (var ihand = 0; ihand < nhands ; ihand++ ){
		var handinfo = us.sample(nconf.get('Locations'),1)[0];
		
		var handData = { HandID: uuidV4(),
						HandLocName: handinfo.Name,
						HandLocSub: us.sample(nconf.get('Rooms')),
						HandLocLat: handinfo.Lat,
						HandLocLon: handinfo.Lon,
						Distance: 0.0
					};
		//console.log("HandData: " + JSON.stringify(handData));
		var cardsinhand = 5;
		if (remainder > 1){
			 cardsinhand = 7;
			 remainder = remainder - 2;
		}
		else if (remainder > 0){
			cardsinhand = 6;
			remainder = remainder - 1;
		}
		
		//console.log("cardsinhand : " + cardsinhand);
		//Shuffle the deck for this hand
		var handcards = us.sample(nconf.get('Cards'),cardsinhand);

		for (var icard = 0; icard < cardsinhand; icard++){
			//console.log('Hand: ' + ihand + ' card ' + icard);
			var cardData = {
							CardID: uuidV4(),
							FaceValue: handcards[icard],
							CardTransMult: (Math.random() * ( 1 + randgen.rpoisson(0.5))).toFixed(2),
							CardOccLevel: 1000 * randgen.rpoisson(0.1)
						};
						
			//console.log("card: " + JSON.stringify(cardData));
			
			var properties = {desired: {
				cardProperties: cardData,
				handProperties: handData,
				
			}};
			
			dealData.push(properties);
			
		}
	}
	console.log("dealData: " + JSON.stringify(dealData));
}



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

//handtester();

//setInterval(queryTwins, 5000);
dealHands();

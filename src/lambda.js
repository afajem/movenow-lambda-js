/**
 * AWS Lambda function that is periodically invoked to determine  if a Fitbit 
 * user has been sedentary over over the last hour. The function retrieves 
 * the Fitbit intra-day step count for the user up to the current time 
 * period and notifies the user through the AWS Simple Notification Service (SNS) 
 * to get moving.
 *
 * Event Flow:
 * 1. AWS CloudWatch Event is triggered hourly using a defined Scheduled Rule
 * 2. The scheduled rule invokes the AWS Lambda function 
 * 3. The lambda function fetches the step count for the user for the past hour
 * 4. If the hourly step goal is not met, a notification message is sent to 
 *    AWS SNS
 * 5. AWS SNS sends an SMS text message to the user to move around
 *
 * @param event AWS event object containing event data 
 * @param  context execution context of the function  
 * @param callback Optional callback to return information to the caller.
  */

exports.handler = function(event, context, callback) {
	"use strict";
 
 	// Retrieve the access token from the invoker
	const accessToken = event.accessToken;

	// Retrieve the hourly step threshold (# of step needed to be met to avoid 
	// considered to be sedentary)
	const minHourlySteps = event.minHourlySteps;
	// The Amazon resource name for the SNS topic
	const snsTopicArn = event.snsTopicArn;
	// The AWS region in which SNS topic resides   
	const snsTopicRegion = event.snsTopicRegion;

	// Base Fitbit URL
	const fitbitBaseUrl = "https://api.fitbit.com/1/user/-/";

	// Load the axios http lib.
	const axios = require('axios');
	// Promise lib.
	const Promise = require('promise');


	/*
		1. Determine the Profile's UTC Offset
		2. Get Intraday Steps
		3. Compute current steps and send notification if applicable
	*/
	getFitbitProfileUTCOffset().
	then(getIntradaySteps).
	then(function(dataset) {
		//Needs to be above our threshold
		let stepCount = 0;

		console.log(`dataset.length=${dataset.length}`);

		for (let index = 0; index < dataset.length; ++index) {
			stepCount += dataset[index].value;
		}

		if (stepCount < minHourlySteps) {
			let message = `You've only move ${stepCount} this hour. Get movin'!` ;

			console.log(message);

		 	// AWS SDK
			const AWS = require('aws-sdk');

			AWS.config.update({
			  'region': snsTopicRegion
			});
			
			//create and configure a new SNS client 
			let sns = new AWS.SNS();

			// Init publish request parameters
			let publishParams = { 
    			TopicArn : snsTopicArn,
    			Message: message
  			};

			/// Send SNS message
  			sns.publish(publishParams, function(err, data) {
    			console.log(`MessageId - ${data.MessageId}`);
  			});		
		}

		callback(null, 'MoveNow Lambda function completed.');
	}).catch(function (error) {
		console.log('error', error);
		callback(error);
	});


	/**
	 * Determines the user's time offset from UTC in milliseconds. This allows us to normalized
	 * the local time with the device's timezone. (at least the last recorded timezone)
	 * @return the UTC offset in milliseconds
	 */
	function getFitbitProfileUTCOffset() {
		return axios({
			url: fitbitBaseUrl + "profile.json",
			method: 'GET',
			headers: {
				'Authorization': 'Bearer ' + accessToken
			}
		}).then(response => {
			let offsetFromUTCMillis = response.data.user.offsetFromUTCMillis
			console.log("User's UTC offest in milliseconds is: " + offsetFromUTCMillis);
			return offsetFromUTCMillis;
		}).catch(error => {
			throw error;
		});
	}


	/**
	 * Get the intraday steps for the current user using the input UTC offet
	 */
	function getIntradaySteps(offsetFromUTCMillis) {
		// Moment.js library
		const moment = require('moment')

		//Get the current date/time and offset based on the Fitbit user's profile
		let now = moment();
		now.add(offsetFromUTCMillis, 'ms');

		//Format date range values
		let hourString = now.get('hour');
		let dateString = now.format("YYYY-MM-DD");

		//URL to fetch data for the current hour
		let url  = fitbitBaseUrl + `activities/steps/date/${dateString}/1d/15min/time/${hourString}:00/${hourString}:59.json`;

		//Fetch the data from Fitbit
		console.log("Invoking Fitbit endpoint at: " + url);

		return axios({
			url: url,
			method: 'GET',
			headers: {
				'Authorization': 'Bearer ' + accessToken
			}
		}).then(response => {
			console.log("Returned payload: \n" + JSON.stringify(response.data["activities-steps-intraday"]));
			let dataset = response.data["activities-steps-intraday"].dataset;
			return dataset;
		}).catch(error => {
			throw error;
		});
	}

}

# Map 1-based optional input ports to variables
dataset1 <- maml.mapInputPort(1) # class: data.frame

# Connect the zip port to the xgboost_plus_trained_model.zip file
install.packages("src/magrittr_1.5.zip",lib="src/",repos=NULL)
install.packages("src/xgboost_0.4-3.zip",lib="src/",repos=NULL)
install.packages("src/jsonlite_0.9.19.zip",lib="src/",repos=NULL)
library(xgboost,lib.loc="src/")
library(Matrix)
library(jsonlite)
library(plyr)
library('geosphere')

model <- xgb.load("src/xgboost_small.model")

handToVector <- function(hand){
    cardarray <- rep(0,52)
    cardID <- 2:14
    names(cardID) <- c("2", "3", "4","5","6","7","8","9","T","J","Q","K","A")
    suiteID <- 1:4
    names(suiteID) <- c("s","d","c","h")
    for (i in 1:length(hand)){
        card <- hand[i]
        cardarray[ cardID[[substr(card,0,1)]]-1 + suiteID[[substr(card,nchar(card),nchar(card))]]*13-13] <- 1     
    }
    return(cardarray)
}

handValue <- function(hand){   
    predicted <- predict(model, t(as.matrix(handToVector(hand))))
    probs<- t(matrix(predicted, nrow=10, ncol=length(predicted)/10))
    #print(probs)
    predicted_label <- max.col(t(predicted)) - 1
    #print(probs)
    return(predicted_label)
}

#Pull the cardDF from the input data string
cardDF<-fromJSON(gsub("([\\])","", dataset1$cardData))
#Add in the CurHandID, CardScore, and Distance variables
cardDF['CurHandID'] <- cardDF['HandID']
cardDF['Distance'] <- 0.0

#Score the hands as they are currently configured.
cardDF<-ddply(cardDF,c("HandID"),
      transform,
      CardScore = handValue(FaceValue)/length(FaceValue))

#Build the handDF to hold the hand information during computation      
handDF <- unique(cardDF[c('HandID','HandLocName','HandLocSub','HandLocLat','HandLocLon')])
drops <- c('HandLocName','HandLocSub','HandLocLat','HandLocLon')
cardDF<-cardDF[ , !(names(cardDF) %in% drops)]



#####################################################################################
#
#Build the card swap Monte Carlo algorithm
#Algorithm from https://github.com/toddwschneider/shiny-salesman/blob/master/helpers.R
#
#####################################################################################


#Temperature anneal based on an s-curve
current_temperature <- function(iter, s_curve_amplitude, s_curve_center, s_curve_width) {
  s_curve_amplitude * s_curve(iter, s_curve_center, s_curve_width)
}
#Calculate s-curve
s_curve <- function(x, center, width) {
  1 / (1 + exp((x - center) / width))
}

#Function to carry out a card swap and check that it is legal (no duplicated cards in a hand)
cardSwap <- function(candidate_config, hand_info){
    legalswap <- FALSE
    firstcard <- NULL
    secondcard <- NULL
    
    while (!legalswap){
        swaphands <- sample(unique(candidate_config['CurHandID'])[,],2)
        swapcards <- c(candidate_config[candidate_config['CurHandID']==swaphands[[1]],][sample(nrow(candidate_config[candidate_config['CurHandID']==swaphands[[1]],]), 1),'CardID'],
                      candidate_config[candidate_config['CurHandID']==swaphands[[2]],][sample(nrow(candidate_config[candidate_config['CurHandID']==swaphands[[2]],]), 1),'CardID'])

        #run the swap using a temp card
        firstcard <- candidate_config[candidate_config$CardID == swapcards[[1]],]
        secondcard <- candidate_config[candidate_config$CardID == swapcards[[2]],]
        candidateDF <- candidate_config
        candidateDF[candidateDF$CardID == swapcards[[1]],'CurHandID'] <- secondcard$CurHandID
        candidateDF[candidateDF$CardID == swapcards[[2]],'CurHandID'] <- firstcard$CurHandID
        #Check to see if it is a legal swap
        legalswap <- !any(duplicated(candidateDF[candidateDF$CurHandID == firstcard$CurHandID,'FaceValue'])) ||
                        !any(duplicated(candidateDF[candidateDF$CurHandID == secondcard$CurHandID,'FaceValue']))

    }
        
    #Score the new configurations
    hand1<-candidateDF[candidateDF$CurHandID==swaphands[[1]],'FaceValue']
    candidateDF[candidateDF$CurHandID==swaphands[[1]],'CardScore'] <- handValue(hand1)/length(hand1)
    hand2<-candidateDF[candidateDF$CurHandID==swaphands[[2]],'FaceValue']
    candidateDF[candidateDF$CurHandID==swaphands[[2]],'CardScore'] <- handValue(hand2)/length(hand2)

    #Move the cards to their new locations and update the displacement vector
    tempcard <- firstcard
    firstcard['CurHandID'] <- secondcard['CurHandID']
    secondcard['CurHandID'] <- tempcard['CurHandID']

    p1<-hand_info[hand_info$HandID == firstcard$CurHandID ,c('HandLocLon','HandLocLat')]
    p2<-hand_info[hand_info$HandID == firstcard$HandID ,c('HandLocLon','HandLocLat')]
    candidateDF[candidateDF$CardID==firstcard$CardID,'Distance'] <- distGeo(p1,p2)/1000 #Returns distance in meters, we want kilometers

    p1<-hand_info[hand_info$HandID == secondcard$CurHandID ,c('HandLocLon','HandLocLat')]
    p2<-hand_info[hand_info$HandID == secondcard$HandID ,c('HandLocLon','HandLocLat')]
    candidateDF[candidateDF$CardID==secondcard$CardID,'Distance'] <- distGeo(p1,p2)/1000 #Returns distance in meters, we want kilometers

    return(list(candidate_config=candidateDF,hands=swaphands,cards=swapcards))    
}

#Split the anneal into pieces that are handled one at a time
run_intermediate_anneal <- function(hand_config, 
                                    hand_score, 
                                    best_config, 
                                    best_score,
                                    starting_iteration, 
                                    number_of_iterations, 
                                    s_curve_amplitude, 
                                    s_curve_center, 
                                    s_curve_width,
                                    hand_info) {
    
    score_history <- rep(0,number_of_iterations)

    for(i in 1:number_of_iterations) {
              
        iter <- starting_iteration + i 
        temp <- current_temperature(iter, s_curve_amplitude, s_curve_center, s_curve_width)
        
        #try a swap: if it is a good swap, we'll keep it later
        swap <- cardSwap(hand_config,hand_info)
        candidate_config <- swap$candidate_config
        
        #score the overall configuration based on this update
        candidate_score <- sum(candidate_config$CardScore)
        
        #the change in score is now dependent on the distance traveled - more distance means less benefit for trading
        
        subtractors <- candidate_config[candidate_config$CardID == swap$cards[[1]],'CardOccLevel'] + 
                        candidate_config[candidate_config$CardID == swap$cards[[1]],'CardTransMult'] * 
                        candidate_config[candidate_config$CardID == swap$cards[[1]],'Distance'] +
                        candidate_config[candidate_config$CardID == swap$cards[[2]],'CardOccLevel'] + 
                        candidate_config[candidate_config$CardID == swap$cards[[2]],'CardTransMult'] * 
                        candidate_config[candidate_config$CardID == swap$cards[[2]],'Distance'] 
        
        #The final score is the candidate score minus the subtractors
        delta <- candidate_score - hand_score - subtractors

        if (temp > 0 ) {
            #This tends to 1 
            ratio <- exp( delta / temp)
        } else {
            #At zero temp, we only keep good flips
            ratio <- as.numeric(delta > 0)
        }
        
        #Get a random number: if it is less than our ratio, keep the flip
        if (runif(1) < ratio) {
          hand_config <- candidate_config
          hand_score <- candidate_score

          if (hand_score > best_score) {
            best_config <- hand_config
            best_score <- hand_score
            
          }
        }
        score_history[i] <- hand_score
    }

    return(list(hand_config=hand_config, hand_score=hand_score, best_config=best_config, best_score=best_score, score_history=score_history)) 
}


#Determine the number of temperature steps to take based on the number of hands
print_iterations <- length(unique(cardDF$HandID))
steps_per_iteration <- 300 #This seems to work well
t_max <- 10
number_of_iterations <- print_iterations * steps_per_iteration
starting_iteration <- 1
t_center <-number_of_iterations/4
t_width <-number_of_iterations/16

#Set the current configuration as our input cardDF
hand_config<-cardDF
original_score <- sum(cardDF$CardScore)
hand_score<-sum(cardDF$CardScore)
best_config<-hand_config
best_score<-hand_score
anneal_results <- NULL
score_history <- rep(0,print_iterations*print_iterations)

for (i in 1:print_iterations){
    start.time <- Sys.time()

    iter <- steps_per_iteration*(i-1)
    anneal_results<-run_intermediate_anneal(hand_config, hand_score, best_config, best_score,
                                            iter, 
                                            steps_per_iteration, 
                                            t_max, 
                                            t_center, 
                                            t_width,
                                            handDF)
    hand_config <- anneal_results$hand_config
    hand_score <- anneal_results$hand_score
    best_config <- anneal_results$best_config
    best_score <- anneal_results$best_score
    score_history[(iter+1):(iter+steps_per_iteration)]<-anneal_results$score_history
    end.time <- Sys.time()
    time.taken <- end.time - start.time
    paste("Round",i,"of",print_iterations,"with score",best_score,"in time:",format(time.taken,digits=2))  
}
plot(score_history)

paste('New Score:',anneal_results$best_score)
best_config <-anneal_results$best_config
paste('Number of cards trading:', nrow(best_config[best_config$HandID !=best_config$CurHandID  ,]),'of',nrow(best_config))

updatedCardDF <- anneal_results$best_config

# Get only the cards where they have moved
movedDF <- updatedCardDF[updatedCardDF$HandID != updatedCardDF$CurHandID,]

# Add in the rest of the hand information we will need to move the card
getLocName <- function(x){
    handDF[handDF$HandID == x['CurHandID'], 'HandLocName']
}
getLocSub <- function(x){
    handDF[handDF$HandID == x['CurHandID'], 'HandLocSub']
}
getLocLat <- function(x){
    handDF[handDF$HandID == x['CurHandID'], 'HandLocLat']
}
getLocLon <- function(x){
    handDF[handDF$HandID == x['CurHandID'], 'HandLocLon']
}

movedDF['MoveHandLocName'] <- apply(movedDF, 1, function(x) getLocName(x))
movedDF['MoveHandLocSub'] <- apply(movedDF, 1, function(x) getLocSub(x))
movedDF['MoveHandLocLat'] <- apply(movedDF, 1, function(x) getLocLat(x))
movedDF['MoveHandLocLon'] <- apply(movedDF, 1, function(x) getLocLon(x))

names(movedDF)[names(movedDF) == 'CurHandID'] <- 'MoveHandID'
outputDF <- dataset1

outputDF['BatchFinishedTime'] <- strftime(as.POSIXlt(Sys.time(), "UTC", "%Y-%m-%dT%H:%M:%S") , "%Y-%m-%dT%H:%M:%S%z")
outputDF['OriginalScore'] <- original_score
outputDF['FinalScore'] <- anneal_results$best_score
outputDF['cardData']<-paste(toJSON(movedDF))

# Select data.frame to be sent to the output Dataset port
maml.mapOutputPort("outputDF");
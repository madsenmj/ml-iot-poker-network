library('mxnet')
model <- mx.model.load('CUDA_model2/pokerhands5M_3cpu.model',600)

#Generate deck for creating hands
deck <- paste0(rep(c(2:9, "T", "J", "Q", "K", "A"), 4),  #card values
               rep(c("s", "h", "d", "c"), each = 13)) #suits

#set up repeatedly used values for scoring the hands
cardarray <- rep(0,52)
cardID <- 2:14
names(cardID) <- c("2", "3", "4","5","6","7","8","9","T","J","Q","K","A")
suiteID <- 1:4
names(suiteID) <- c("s","d","c","h")
handarray <- rep(0,256)

handValue <- function(hand){
    #cardarray[int(suit_int)*13 + rank_int] = 1
    for (i in 1:length(hand)){
        card <- hand[i]
        cardarray[ cardID[[substr(card,0,1)]]-1 + suiteID[[substr(card,nchar(card),nchar(card))]]*13-13] <- 1     
    }
    
    handConverted<-data.matrix(cardarray)
    #Paste the data in the right places to make this work as a 16 by 16 array and then reshape for scoring
    handarray[99:111] <- handConverted[1:13]
    handarray[115:127]<- handConverted[14:26]
    handarray[131:143]<- handConverted[27:39]
    handarray[147:159]<- handConverted[40:52]

    h2<-data.matrix(handarray)
    h_array <- h2
    dim(h_array)<-c(16,16,1,1)
    
    predicted <- predict(model, h_array)
    predicted_label <- max.col(t(predicted)) - 1
    return(predicted_label)
}


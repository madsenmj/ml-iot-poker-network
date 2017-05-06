
#install.packages('holdem', repos='http://cran.us.r-project.org')
#install.packages('caret', repos='http://cran.us.r-project.org',dependencies = T)
library(caret)
#library(IRdisplay)
#options(jupyter.plot_mimetypes = 'image/png')

library(e1071)
library(cowplot)
library(gbm)
#install.packages('mxnet', repos='http://cran.us.r-project.org')
library(mxnet)

sink("v3runoutput.txt", append=TRUE,split=TRUE)

as.numeric.factor <- function(x) {as.numeric(levels(x))[x]}

#source('https://bioconductor.org/biocLite.R')
#biocLite("EBImage")
#library(EBImage)

# Set seed for reproducibility
mx.set.seed(100)

print("Loading Data...")
hands<-read.fwf(file='hand_data//npdata_5M.txt',widths=c(rep(1,53)))

print("Preparing Data as imagettes...")

hands[] <- lapply(hands, as.numeric)
colnames(hands)[names(hands) == 'V53']<-"score"
#str(hands)

intrain<-createDataPartition(y=hands$score,p=0.8,list=FALSE)
training<-hands[intrain,]
testing<-hands[-intrain,]

training <-data.matrix(training)

#We want to move the card data down to the middle of the image array for processing in the neural network
#This shifts the data to the mid-point of the image
leftzeros <- matrix(0, ncol = 98, nrow = nrow(training))
midcolumn <- matrix(0, ncol = 3, nrow = nrow(training))
rightzeros <- matrix(0, ncol = 97, nrow = nrow(training))

#Paste the zeros in the right places to make this work as a 28 by 28 array and then reshape for training
training2 <- cbind(leftzeros,training[,1:13],midcolumn,
                   training[,14:26],midcolumn,
                   training[,27:39],midcolumn,
                   training[,40:52],rightzeros)
train2<-t(data.matrix(training2))
train_array <-train2
dim(train_array)<-c(16,16,1,ncol(train2))
train_y <-training[,53]

#print(training[30005,])
#display(Image(train_array[,,,30005],dim=c(16,16)))

testing <-data.matrix(testing)
#Do the same thing with the test array
leftzeros <- matrix(0, ncol = 98, nrow = nrow(testing))
midcolumn <- matrix(0, ncol = 3, nrow = nrow(testing))
rightzeros <- matrix(0, ncol = 97, nrow = nrow(testing))

#Paste the zeros in the right places to make this work as a 28 by 28 array and then reshape for training
testing2 <- cbind(leftzeros,testing[,1:13],midcolumn,
                   testing[,14:26],midcolumn,
                   testing[,27:39],midcolumn,
                   testing[,40:52],rightzeros)
testing2<-t(data.matrix(testing2))
test_array <-testing2
dim(test_array)<-c(16,16,1,ncol(testing2))
test_y <-testing[,53]

print(table(train_y))
print(table(test_y))

# Set up the symbolic model
#-------------------------------------------------------------------------------

data <- mx.symbol.Variable('data')
# 1st convolutional layer
conv_1 <- mx.symbol.Convolution(data = data, kernel = c(5, 5), num_filter = 20)
tanh_1 <- mx.symbol.Activation(data = conv_1, act_type = "tanh")
pool_1 <- mx.symbol.Pooling(data = tanh_1, pool_type = "max", kernel = c(2, 2), stride = c(2, 2))
# 2nd convolutional layer
conv_2 <- mx.symbol.Convolution(data = pool_1, kernel = c(5, 5), num_filter = 50)
tanh_2 <- mx.symbol.Activation(data = conv_2, act_type = "tanh")
pool_2 <- mx.symbol.Pooling(data=tanh_2, pool_type = "max", kernel = c(2, 2), stride = c(2, 2))
# 1st fully connected layer
flatten <- mx.symbol.Flatten(data = pool_2)
fc_1 <- mx.symbol.FullyConnected(data = flatten, num_hidden = 500)
tanh_3 <- mx.symbol.Activation(data = fc_1, act_type = "tanh")
# 2nd fully connected layer
fc_2 <- mx.symbol.FullyConnected(data = tanh_3, num_hidden = 40)
# Output. Softmax output since we'd like to get some probabilities.
NN_model <- mx.symbol.SoftmaxOutput(data = fc_2)

# Pre-training set up
#-------------------------------------------------------------------------------


# Device used. CPU in my case.

n.gpu<-4
devices <- lapply(0:(n.gpu-1), function(i) {
  mx.gpu(i)
})

#devices <- c(mx.gpu(0),mx.gpu(1))

# Training
#-------------------------------------------------------------------------------

# Train the model
model <- mx.model.FeedForward.create(NN_model,
                                     X = train_array,
                                     y = train_y,
                                     ctx = devices,
                                     num.round = 600,
                                     array.batch.size = 4000,
                                     learning.rate = 0.01,
                                     momentum = 0.9,
                                     eval.metric = mx.metric.accuracy,
                                     epoch.end.callback = mx.callback.log.train.metric(100))



# Testing
#-------------------------------------------------------------------------------

# Predict labels
predicted <- predict(model, test_array)
# Assign labels
predicted_labels <- max.col(t(predicted)) - 1
# Get accuracy
sum(diag(table(test_y, predicted_labels)))/40

print(table(test_y))
print(table(predicted_labels))

u = union(predicted_labels, test_y)
t = table(factor(predicted_labels, u), factor(test_y, u))
print(confusionMatrix(t))

mx.model.save(model, 'pokerhands5M_3.model', 600)

newmodel <- mx.model.FeedForward.create(model$symbol,
                                     X = train_array,
                                     y = train_y,
                                     ctx = mx.cpu(),
                                     num.round = 1,
                                     array.batch.size = 4000,
                                     learning.rate = 0.01,
                                     momentum = 0.9,
                                     eval.metric = mx.metric.accuracy,
                                     epoch.end.callback = mx.callback.log.train.metric(100),
				     arg.params=model$arg.params,
				     aux.params=model$aux.params)



mx.model.save(newmodel, 'pokerhands5M_3_cpu.model', 601)

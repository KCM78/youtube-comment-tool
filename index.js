const { google } = require('googleapis');
const fs = require('fs-extra');
const config = require('./config.json');
const createCsvWriter = require('csv-writer').createObjectCsvWriter

const videoId = process.argv[2];
const OUTPUT_FILENAME = `${videoId}-comments.${config.saveFormat}`;
const youtube = google.youtube('v3');

let nextPageToken = '';
let comments = [];
let replies = [];

// Catches any errors
const catchError = (err) => { 
  if (err) {
    console.error(`There was an error: ${err}`);
    process.exit(1);
  }
};

// Comparison function for sorting replies by published datetime
const compare = (a, b) => {
  if (a.publishedAt < b.publishedAt){
    return -1;
  }
  if (a.publishedAt > b.publishedAt){
    return 1;
  }
  return 0;
}

// Makes the call to the API to get comments
const getCommentsPage = async () => {
  const response = await youtube.commentThreads.list({
    auth: config.apiKey,
    part: config.part,
    videoId,
    maxResults: config.maxResults,
    pageToken: nextPageToken,
    order: config.order
  }).catch(catchError);
  nextPageToken = response.data.nextPageToken;
  const filteredComments = response.data.items.map((comment) => ({
    commentId: comment.id,
    authorChannelId: comment.snippet.topLevelComment.snippet.authorChannelId.value,
    text: comment.snippet.topLevelComment.snippet.textDisplay,
    replies: comment.snippet.totalReplyCount,
    repliesText: []
  }));
  comments.push(filteredComments);
}

// makes API call to get the replies
const getReplies = async (id) => {
  const response = await youtube.comments.list({
    auth: config.apiKey,
    part: config.part,
    parentId: id,
    order: config.order
   }).catch(catchError);
  const filteredReplies = response.data.items.map((reply) => ({
    parentId: reply.snippet.parentId,
    text: reply.snippet.textDisplay,
    published: reply.snippet.publishedAt
  }));
  replies.push(filteredReplies.sort(compare));
}

// Writes the csv file
const outputCSV = () => {
  const csvWriter = createCsvWriter({
    path: OUTPUT_FILENAME,
    header: [
      { id: 'commentId', title: 'Comment ID' },
      { id: 'authorChannelId', title: 'Author Channel ID' },
      { id: 'text', title: 'Text' }
    ]
  });
  csvWriter.writeRecords(comments.flat(comments.length)).catch(catchError);
}

// Saves the comments to csv or json
const saveFile = () => {
  switch (config.saveFormat) {
    case 'csv':
      outputCSV();
      break;
    case 'json':
      fs.outputFile(OUTPUT_FILENAME, JSON.stringify(comments.flat(), null, 4), catchError);
      break;
    default:
  }
  console.log(`Comments saved to ${OUTPUT_FILENAME}`);
}

// This is kinda horrible but it gets a list of comments that have replies
// then loops through those and gets the replies for them as a separate list
// then loops through both lists and matches the replies to the parent thread
// and adds the replies to the final output. Blech.
const handleReplies = async () => {
  const haveReplies = comments.flat().filter((comment) => comment.replies > 0);
  for (let i = 0; i < haveReplies.length; i++) {
    await getReplies(haveReplies[i].commentId);
  }
  replies.forEach((reply) => {
    comments.flat().forEach((comment) => {
      if (comment.commentId === reply[0].parentId) {
        comment.repliesText.push.apply(comment.repliesText, reply.map(r => r.text));
      }
    });
  });
}

// Gets the comments and checks if replies are wanted
const getAllComments = async () => {
  await getCommentsPage();
  // Keeps getting comments until there's no more pages
  while (nextPageToken) {
    await getCommentsPage();
  }
  // Do we want replies included?
  if (config.includeReplies) {
    await handleReplies();
  }
  saveFile();
}

// Main function that kicks it all off
const main = () => {
  if (!process.argv[2]) {
    console.log('No videoId provided');
    process.exit(1);
  }
  getAllComments();
}

main();
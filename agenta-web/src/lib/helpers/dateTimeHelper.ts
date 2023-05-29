export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);

  const formattedDate = date.toLocaleDateString();
  const formattedTime = date.toLocaleTimeString();

  return `${formattedDate} ${formattedTime}`;
};
// Chat.tsx

import React, { useState } from "react";
import { List, Input, Button } from "antd";

type Message = {
  sender: "user" | "bot";
  content: string;
};

type ChatProps = {
  chat?: Message[];
  onChatChange: (newChat: Message[]) => void;
};

const Chat: React.FC<ChatProps> = ({ chat = [], onChatChange }) => {
  const [input, setInput] = useState("");

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleInputSubmit = () => {
    onChatChange([...chat, { sender: "user", content: input }]);
    setInput("");
  };

  const startNewChat = () => {
    onChatChange([]);
  };

  return (
    <div>
      <List
        itemLayout="horizontal"
        dataSource={chat}
        renderItem={(message) => (
          <List.Item>
            <List.Item.Meta
              title={message.sender}
              description={message.content}
            />
          </List.Item>
        )}
      />
      <Input
        value={input}
        onChange={handleInputChange}
        onPressEnter={handleInputSubmit}
        placeholder="Type a message..."
      />
      <Button onClick={startNewChat}>Start New Chat</Button>
    </div>
  );
};

Chat.defaultProps = {
  chat: [
    { sender: "user", content: "Hello, bot!" },
    { sender: "bot", content: "Hello, user!" },
  ],
};

export default Chat;

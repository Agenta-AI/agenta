import React from "react";
import { Modal, Button } from "antd";

interface Props {
  isModalOpen: boolean;
  setIsModalOpen: (value: boolean) => void;
  handleRemove: () => void;
  handleCancel: () => void;
}

const VariantRemovalWarningModal: React.FC<Props> = ({
  isModalOpen,
  setIsModalOpen,
  handleRemove,
  handleCancel,
}) => {
  const handleCloseModal = () => setIsModalOpen(false);

  const handleDelete = () => {
    handleRemove();
    handleCloseModal();
  };

  const handleDismiss = () => {
    handleCancel();
    handleCloseModal();
  };

  return (
    <Modal
      title="Delete Variant"
      open={isModalOpen}
      onCancel={handleDismiss}
      footer={null}
      centered
    >
      <p>You're about to delete this variant. This action is irreversible.</p>
      <p>Are you sure you want to proceed?</p>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={handleDismiss} style={{ marginRight: 10 }}>
          Cancel
        </Button>
        <Button type="primary" danger onClick={handleDelete}>
          Delete
        </Button>
      </div>
    </Modal>
  );
};

export default VariantRemovalWarningModal;

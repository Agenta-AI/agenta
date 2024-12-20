// import { PropertySchema } from '../types/parsedSchema'

// interface MessageProps {
//     schema: {
//         properties: Record<string, PropertySchema>
//     }
//     value: Record<string, any>
//     onChange: (newValue: Record<string, any>) => void
// }

// export const Message: React.FC<MessageProps> = ({ schema, value, onChange }) => {
//     return (
//         <div>
//             {Object.entries(schema.properties).map(([key, property]) => (
//                 <PropertyElement
//                     key={key}
//                     property={property}
//                     value={value[key]}
//                     onChange={(newValue) => {
//                         onChange({ ...value, [key]: newValue })
//                     }}
//                 />
//             ))}
//         </div>
//     )
// }
